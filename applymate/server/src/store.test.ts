import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectionSchema, profileSchema } from "@applymate/contracts";
import { Cipher, loadCipher } from "./crypto.js";
import { initialProfile } from "./candidate.js";
import { metadata, Store } from "./store.js";

describe("authenticated local encryption", () => {
  it("round-trips empty and Unicode values with random nonces and bound ownership", () => {
    const cipher = new Cipher(randomBytes(32));
    for (const value of ["", "Synthetic resume for Jos\u00e9"]) {
      const sealed = cipher.seal(value, "owner:profile:id");
      expect(cipher.open(sealed, "owner:profile:id")).toBe(value);
      expect(cipher.seal(value, "owner:profile:id")).not.toBe(sealed);
      expect(() => cipher.open(sealed, "different-owner:profile:id")).toThrow();
      expect(() => new Cipher(randomBytes(32)).open(sealed, "owner:profile:id")).toThrow();
      const modified = Buffer.from(sealed.slice(3), "base64");
      modified[0] ^= 1;
      expect(() => cipher.open(`v1:${modified.toString("base64")}`, "owner:profile:id")).toThrow();
    }
    expect(cipher.authSecret()).toBe(cipher.authSecret());
    expect(new Cipher(randomBytes(32)).authSecret()).not.toBe(cipher.authSecret());
    expect(() => cipher.open("v2:invalid", "context")).toThrow();
    expect(() => cipher.open("v1:AA==", "context")).toThrow();
    expect(() => new Cipher(Buffer.alloc(16))).toThrow();
  });
});

describe("owned, immutable, persistent local storage", () => {
  let directory: string;
  let cipher: Cipher;
  const profile = initialProfile("persisted@example.test");
  const owner = "synthetic-storage-owner";
  const another = "synthetic-other-owner";
  const connection = connectionSchema.parse({
    ...metadata(), provider: "openai", model: "fixture-model", suffix: "test", status: "untested", testedAt: null
  });

  async function withStore<T>(operation: (store: Store) => Promise<T>, key = cipher): Promise<T> {
    const database = new PGlite(join(directory, "postgres"));
    try {
      const store = new Store(database, key);
      await store.migrate();
      return await operation(store);
    } finally { await database.close(); }
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "applymate-storage-test-"));
    cipher = await loadCipher(directory);
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it("persists encrypted objects, private values, sessions, and atomic revision/limit checks", async () => {
    await withStore(async (store) => {
      for (const id of [owner, another]) {
        await store.database.query(`INSERT INTO "user"(id, name, email, "createdAt", "updatedAt", "termsVersion")
          VALUES ($1, 'Synthetic', $2, now(), now(), 'test')`, [id, `${id}@example.test`]);
      }
      await store.database.query(`INSERT INTO session(id, token, "expiresAt", "createdAt", "updatedAt", "userId")
        VALUES ('fixture-session', 'synthetic-local-session-token', now() + interval '1 day', now(), now(), $1)`, [owner]);
      await store.create(owner, "profile", profile);
      await store.create(owner, "connection", connection);
      await store.putPrivate(owner, connection.id, "key", "synthetic-private-key");
      await expect(store.get(another, "profile", profile.id, profileSchema)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(store.getPrivate(another, connection.id, "key")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(store.putPrivate(another, connection.id, "key", "replacement")).rejects.toMatchObject({ code: "PRIVATE_RESOURCE" });
      await expect(store.putPrivate(owner, connection.id, "key", "replacement")).rejects.toMatchObject({ code: "PRIVATE_RESOURCE" });
      await expect(store.putPrivate(owner, profile.id, "key", "wrong-kind")).rejects.toMatchObject({ code: "PRIVATE_RESOURCE" });
      await store.update(owner, "profile", { ...profile, revision: 1 }, 0);
      await expect(store.update(owner, "profile", profile, 0)).rejects.toMatchObject({ code: "CHANGED_OR_IMMUTABLE" });
      const rolledBack = initialProfile("rollback@example.test");
      await expect(store.transaction(async (tx) => {
        await tx.create(another, "profile", rolledBack);
        throw new Error("intentional rollback");
      })).rejects.toThrow("intentional rollback");
      expect(await store.count(another, "profile")).toBe(0);
      await store.consumeLimit(owner, "test-limit", 1);
      await expect(store.consumeLimit(owner, "test-limit", 1)).rejects.toMatchObject({ code: "LIMIT_REACHED" });
      await store.update(owner, "connection", connection, 0, true);
      await expect(store.remove(owner, "connection", connection.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(store.update(owner, "connection", connection, 1)).rejects.toMatchObject({ code: "CHANGED_OR_IMMUTABLE" });
      const raw = await store.database.query<{ payload: string }>("SELECT payload FROM objects UNION ALL SELECT payload FROM private_data");
      expect(raw.rows.every((row) => row.payload.startsWith("v1:") && !row.payload.includes("synthetic-private-key"))).toBe(true);
    });
    const reopenedCipher = await loadCipher(directory);
    await withStore(async (store) => {
      expect((await store.get(owner, "profile", profile.id, profileSchema)).value.revision).toBe(1);
      expect(await store.getPrivate(owner, connection.id, "key")).toBe("synthetic-private-key");
      const sessions = await store.database.query<{ count: number }>("SELECT count(*)::int AS count FROM session");
      expect(sessions.rows[0].count).toBe(1);
    }, reopenedCipher);
  });

  it("rejects the wrong key without replacing existing data, including legacy marker initialization", async () => {
    const wrong = new Cipher(randomBytes(32));
    await withStore(async (store) => {
      // Model a pre-versioning database while retaining its encrypted owned records.
      await store.database.exec("DROP TABLE schema_migrations");
    });
    await expect(withStore(async () => undefined, wrong)).rejects.toMatchObject({ code: "KEY_MISMATCH" });
    await withStore(async (store) => {
      expect(await store.getPrivate(owner, connection.id, "key")).toBe("synthetic-private-key");
      const applied = await store.database.query<{ version: number }>("SELECT version FROM schema_migrations");
      expect(applied.rows).toEqual([{ version: 1 }]);
      await store.database.query("DELETE FROM storage_metadata WHERE key = 'cipher'");
    });
    await expect(withStore(async () => undefined, wrong)).rejects.toMatchObject({ code: "KEY_MISMATCH" });
    await withStore(async (store) => {
      expect((await store.get(owner, "profile", profile.id, profileSchema)).value.revision).toBe(1);
      const marker = await store.database.query("SELECT key FROM storage_metadata WHERE key = 'cipher'");
      expect(marker.rows).toHaveLength(1);
    });
  });

  it("deletes all live owned data and refuses to manufacture a replacement for a lost key", async () => {
    await withStore(async (store) => {
      await store.deleteUser(owner);
      expect(await store.count(owner, "profile")).toBe(0);
      await expect(store.getPrivate(owner, connection.id, "key")).rejects.toMatchObject({ code: "NOT_FOUND" });
      const sessions = await store.database.query("SELECT id FROM session");
      const limits = await store.database.query("SELECT owner FROM operation_limits");
      expect(sessions.rows).toHaveLength(0);
      expect(limits.rows).toHaveLength(0);
    });
    const keyPath = join(directory, "local-encryption.key");
    const original = await readFile(keyPath);
    await unlink(keyPath);
    await expect(loadCipher(directory)).rejects.toMatchObject({ code: "KEY_MISSING" });
    await expect(readFile(keyPath)).rejects.toMatchObject({ code: "ENOENT" });
    const configured = await loadCipher(directory, original.toString("base64"));
    await withStore(async (store) => expect(await store.count(owner, "profile")).toBe(0), configured);
    await expect(loadCipher(directory, "not a key")).rejects.toMatchObject({ code: "KEY_FORMAT" });
    const untouched = join(directory, "unused");
    await mkdir(untouched);
    await loadCipher(untouched, original.toString("base64"));
    await expect(readFile(join(untouched, "local-encryption.key"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
