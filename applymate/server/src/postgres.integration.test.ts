import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { connectionSchema, policyVersion, profileSchema } from "@applymate/contracts";
import { createApp } from "./app.js";
import { initialProfile } from "./candidate.js";
import { Cipher } from "./crypto.js";
import { PostgresDatabase } from "./database.js";
import { metadata, Store } from "./store.js";

const url = process.env.APPLYMATE_TEST_DATABASE_URL;
// This suite uses an ephemeral CI database, never a developer or deployed workspace.
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/applymate_foundation_test") {
    throw new Error("PostgreSQL integration tests require a loopback applymate_foundation_test database.");
  }
}

describe.skipIf(!url)("real pooled PostgreSQL foundation", () => {
  let database: PostgresDatabase;
  let store: Store;
  const cipher = new Cipher(randomBytes(32));
  const owner = randomUUID(), other = randomUUID();
  const profile = initialProfile("synthetic-postgres@example.test");
  const connection = connectionSchema.parse({
    ...metadata(), provider: "openai", model: "fixture-model", suffix: "test", status: "untested", testedAt: null
  });
  beforeAll(async () => {
    database = new PostgresDatabase(url!, 5);
    store = new Store(database, cipher);
    await Promise.all([store.migrate(true), new Store(database, cipher).migrate(true)]);
    for (const id of [owner, other]) {
      await database.query(`INSERT INTO "user"(id,name,email,"createdAt","updatedAt","termsVersion")
        VALUES ($1,'Synthetic','shared@example.test',now(),now(),$2)`, [id, policyVersion]);
    }
  });
  afterAll(async () => {
    if (store) { await store.deleteUser(owner); await store.deleteUser(other); }
    if (database) await database.close();
  });

  it("uses versioned idempotent migrations and refuses unknown versions or wrong encryption keys", async () => {
    expect((await database.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version")).rows)
      .toEqual([{ version: 1 }, { version: 2 }]);
    await expect(new Store(database, new Cipher(randomBytes(32))).migrate(true)).rejects.toMatchObject({ code: "KEY_MISMATCH" });
    await database.query("INSERT INTO schema_migrations(version,name) VALUES (999,'future')");
    try { await expect(store.migrate(true)).rejects.toMatchObject({ code: "MIGRATION_VERSION" }); }
    finally { await database.query("DELETE FROM schema_migrations WHERE version = 999"); }
    await store.migrate(true);
  });

  it("preserves encrypted ownership, immutable objects, rollback and atomic concurrent limits/revisions", async () => {
    await store.create(owner, "profile", profile);
    await store.create(owner, "connection", connection);
    await store.putPrivate(owner, connection.id, "key", "synthetic-provider-key");
    await expect(store.get(other, "profile", profile.id, profileSchema)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(store.getPrivate(other, connection.id, "key")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(store.putPrivate(other, connection.id, "key", "replacement")).rejects.toMatchObject({ code: "PRIVATE_RESOURCE" });
    await expect(store.putPrivate(owner, connection.id, "key", "replacement")).rejects.toMatchObject({ code: "PRIVATE_RESOURCE" });
    await expect(store.transaction(async (tx) => {
      await tx.create(other, "profile", initialProfile("rollback@example.test"));
      throw new Error("intentional rollback");
    })).rejects.toThrow("intentional rollback");
    expect(await store.count(other, "profile")).toBe(0);
    const revisions = await Promise.allSettled([
      store.update(owner, "profile", { ...profile, revision: 1 }, 0),
      store.update(owner, "profile", { ...profile, revision: 1 }, 0)
    ]);
    expect(revisions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(revisions.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "CHANGED_OR_IMMUTABLE" }
    });
    const limits = await Promise.allSettled(Array.from({ length: 10 }, () => store.consumeLimit(owner, "concurrent", 3)));
    expect(limits.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    for (const result of limits) {
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "LIMIT_REACHED" });
    }
    await store.update(owner, "connection", connection, 0, true);
    await expect(store.remove(owner, "connection", connection.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(store.update(owner, "connection", connection, 1)).rejects.toMatchObject({ code: "CHANGED_OR_IMMUTABLE" });
    const raw = await database.query<{ payload: string }>(
      "SELECT payload FROM objects WHERE owner=$1 UNION ALL SELECT payload FROM private_data WHERE owner=$1", [owner]);
    expect(raw.rows.every((row) => row.payload.startsWith("v1:") && !row.payload.includes("synthetic-provider-key"))).toBe(true);
    const reopened = new PostgresDatabase(url!, 2);
    try {
      const persisted = new Store(reopened, cipher);
      await persisted.migrate(true);
      expect((await persisted.get(owner, "profile", profile.id, profileSchema)).revision).toBe(1);
      expect(await persisted.getPrivate(owner, connection.id, "key")).toBe("synthetic-provider-key");
    } finally { await reopened.close(); }
    await database.query(`INSERT INTO session(id,token,"expiresAt","createdAt","updatedAt","userId")
      VALUES ($1,$2,now()+interval '1 day',now(),now(),$3)`, [randomUUID(), randomUUID(), owner]);
    await store.deleteUser(owner);
    expect((await database.query("SELECT id FROM objects WHERE owner=$1", [owner])).rows).toHaveLength(0);
    expect((await database.query("SELECT id FROM private_data WHERE owner=$1", [owner])).rows).toHaveLength(0);
    expect((await database.query('SELECT id FROM session WHERE "userId"=$1', [owner])).rows).toHaveLength(0);
    expect((await database.query("SELECT owner FROM operation_limits WHERE owner=$1", [owner])).rows).toHaveLength(0);
  });

  it("runs public cloud consent, separate same-email workspaces, export and deletion through the real API", async () => {
    const origin = "https://applymate-test.azurewebsites.net";
    const tenant = "11111111-1111-4111-8111-111111111111";
    const first = randomUUID(), second = randomUUID();
    const runtime = await createApp({
      cipher, origin, origins: [origin], databaseUrl: url,
      cloud: { tenant, objectId: first, publicSignup: true }
    });
    const headers = (oid: string) => ({
      Host: new URL(origin).host, Origin: origin, "X-Applymate-Request": "1",
      "X-MS-CLIENT-PRINCIPAL": Buffer.from(JSON.stringify({ auth_typ: "aad", claims: [
        { typ: "tid", val: tenant }, { typ: "oid", val: oid },
        { typ: "preferred_username", val: "shared-api@example.test" },
        { typ: "iat", val: String(Math.floor(Date.now() / 1000)) }
      ] })).toString("base64")
    });
    try {
      const api = request(runtime.app);
      expect((await api.get("/api/workspace").set("Host", new URL(origin).host)).status).toBe(401);
      for (const id of [first, second]) {
        expect((await api.post("/api/cloud-account").set(headers(id)).send({ consent: true, policyVersion })).status).toBe(200);
      }
      const one = await api.get("/api/workspace").set(headers(first));
      const two = await api.get("/api/workspace").set(headers(second));
      expect(one.status).toBe(200); expect(two.status).toBe(200);
      expect(one.body.user.id).not.toBe(two.body.user.id);
      expect(one.body.profile.id).not.toBe(two.body.profile.id);
      expect((await api.get("/api/account/export").set(headers(second))).body.profile.id).toBe(two.body.profile.id);
      expect((await api.post("/api/auth/sign-in/email-otp").set(headers(first)).send({})).status).toBe(404);
      expect((await api.delete("/api/account").set(headers(second)).send({ confirmation: "delete" })).status).toBe(400);
      expect((await api.delete("/api/account").set(headers(second)).send({ confirmation: "DELETE" })).status).toBe(200);
      expect((await api.get("/api/workspace").set(headers(second))).status).toBe(401);
      expect((await api.get("/api/workspace").set(headers(first))).body.profile.id).toBe(one.body.profile.id);
      expect((await api.delete("/api/account").set(headers(first)).send({ confirmation: "DELETE" })).status).toBe(200);
    } finally { await runtime.close(); }
  });
});
