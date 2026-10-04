import { randomBytes } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { policyVersion } from "@applymate/contracts";
import { createApp } from "./app.js";
import { Cipher } from "./crypto.js";

const origin = "https://applymate-test.azurewebsites.net";
const cloud = { tenant: "test-tenant", objectId: "test-owner" };
function principal(oid = cloud.objectId, issued = Math.floor(Date.now() / 1000), extraClaims: { typ: string; val: string }[] = []) {
  return Buffer.from(JSON.stringify({
    auth_typ: "aad", claims: [
      { typ: "tid", val: cloud.tenant }, { typ: "oid", val: oid },
      { typ: "preferred_username", val: "pilot@example.test" },
      { typ: "name", val: "Pilot Test" }, { typ: "iat", val: String(issued) }, ...extraClaims
    ]
  })).toString("base64");
}

describe("Azure owner-restricted pilot", () => {
  it("requires platform identity and explicit consent, persists owned records and disables local authentication", async () => {
    const runtime = await createApp({ cipher: new Cipher(randomBytes(32)), origin, origins: [origin], cloud });
    try {
      const api = request(runtime.app);
      const headers = { Host: new URL(origin).host, Origin: origin, "X-Applymate-Request": "1", "X-MS-CLIENT-PRINCIPAL": principal() };
      expect((await api.get("/api/session").set("Host", new URL(origin).host)).body).toEqual({ user: null, authenticated: false });
      expect((await api.get("/api/session").set(headers).set("X-MS-CLIENT-PRINCIPAL", principal("other-owner"))).status).toBe(403);
      expect((await api.get("/api/session").set(headers)).body.user).toBeNull();
      expect((await api.get("/api/session").set(headers)).body.authenticated).toBe(true);
      expect((await api.get("/api/workspace").set(headers)).status).toBe(401);
      expect((await api.post("/api/cloud-account").set(headers).send({ consent: false, policyVersion })).status).toBe(400);
      expect((await api.post("/api/cloud-account").set(headers).send({ consent: true, policyVersion })).status).toBe(200);
      const session = await api.get("/api/session").set(headers);
      expect(session.body.user.email).toBe("pilot@example.test");
      const workspace = await api.get("/api/workspace").set(headers);
      expect(workspace.status).toBe(200);
      expect(workspace.headers["referrer-policy"]).toBe("same-origin");
      expect(workspace.body.capabilities).toMatchObject({ localOnly: false, mailMode: "microsoft" });
      expect((await api.post("/api/local-mail").set(headers).send({ email: "pilot@example.test" })).status).toBe(404);
      expect((await api.post("/api/auth/email-otp/send-verification-otp").set(headers).send({ email: "pilot@example.test", type: "sign-in" })).status).toBe(404);
      expect((await api.post("/api/cloud-account").set(headers).set("Origin", "https://attacker.test").send({ consent: true, policyVersion })).status).toBe(403);
      const stale = principal(cloud.objectId, Math.floor(Date.now() / 1000) - 600);
      const denied = await api.delete("/api/account").set(headers).set("X-MS-CLIENT-PRINCIPAL", stale).send({ confirmation: "DELETE" });
      expect(denied.status).toBe(403);
      expect(denied.body.error).toMatchObject({ code: "REAUTHENTICATE", message: expect.stringContaining("Verify Microsoft sign-in again") });
      for (const typ of ["auth_time", "http://schemas.microsoft.com/ws/2008/06/identity/claims/authenticationinstant"]) {
        const val = typ === "auth_time" ? String(Math.floor(Date.now() / 1000) - 600) : new Date(Date.now() - 600000).toISOString();
        const renewedToken = principal(cloud.objectId, undefined, [{ typ, val }]);
        expect((await api.delete("/api/account").set(headers).set("X-MS-CLIENT-PRINCIPAL", renewedToken).send({ confirmation: "DELETE" })).status).toBe(403);
      }
      const invalidTime = principal(cloud.objectId, undefined, [{ typ: "auth_time", val: "invalid" }]);
      expect((await api.get("/api/session").set(headers).set("X-MS-CLIENT-PRINCIPAL", invalidTime)).status).toBe(401);
      expect((await api.get("/api/workspace").set(headers)).status).toBe(200);
      expect((await api.delete("/api/account").set(headers).send({ confirmation: "delete" })).status).toBe(400);
      const freshMapped = principal(cloud.objectId, undefined, [{
        typ: "http://schemas.microsoft.com/ws/2008/06/identity/claims/authenticationinstant", val: new Date().toISOString()
      }]);
      expect((await api.delete("/api/account").set(headers).set("X-MS-CLIENT-PRINCIPAL", freshMapped).send({ confirmation: "DELETE" })).status).toBe(200);
      expect((await api.get("/api/session").set(headers)).body.user).toBeNull();
      expect((await api.get("/api/workspace").set(headers)).status).toBe(401);
    } finally { await runtime.close(); }
  });

  it("allows public signup while isolating identities, private records and deletion", async () => {
    const tenant = "11111111-1111-4111-8111-111111111111";
    const first = "22222222-2222-4222-8222-222222222222";
    const second = "00000000-0000-0000-1234-123456789abc";
    const runtime = await createApp({ cipher: new Cipher(randomBytes(32)), origin, origins: [origin], cloud: { tenant, objectId: first, publicSignup: true } });
    const headers = (oid: string, email: string, tid = tenant) => ({
      Host: new URL(origin).host, Origin: origin, "X-Applymate-Request": "1",
      "X-MS-CLIENT-PRINCIPAL": Buffer.from(JSON.stringify({ auth_typ: "aad", claims: [
        { typ: "tid", val: tid }, { typ: "oid", val: oid }, { typ: "preferred_username", val: email },
        { typ: "iat", val: String(Math.floor(Date.now() / 1000)) }
      ] })).toString("base64")
    });
    try {
      const api = request(runtime.app);
      const anonymous = { Host: new URL(origin).host, Origin: origin, "X-Applymate-Request": "1" };
      expect((await api.get("/api/capabilities").set(anonymous)).status).toBe(200);
      expect((await api.get("/api/session").set(anonymous)).body).toEqual({ user: null, authenticated: false });
      expect((await api.get("/api/workspace").set(anonymous)).status).toBe(401);
      expect((await api.delete("/api/account").set(anonymous).send({ confirmation: "DELETE" })).status).toBe(401);
      expect((await api.post("/api/cloud-account").set(anonymous).send({ consent: true, policyVersion })).status).toBe(401);
      const owner = headers(first, "first@example.test");
      const other = headers(second, "second@example.test", "9188040d-6c67-4c5b-b112-36a304b66dad");
      for (const user of [owner, other]) {
        expect((await api.post("/api/cloud-account").set(user).send({ consent: true, policyVersion })).status).toBe(200);
      }
      const one = (await api.get("/api/workspace").set(owner)).body;
      const two = (await api.get("/api/workspace").set(other)).body;
      expect(one.user.id).not.toBe(two.user.id);
      expect(one.profile.id).not.toBe(two.profile.id);
      expect(two.documents).toHaveLength(0);
      expect((await api.get("/api/account/export").set(other)).body.profile.id).toBe(two.profile.id);
      const duplicateEmail = headers("55555555-5555-4555-8555-555555555555", "first@example.test");
      expect((await api.post("/api/cloud-account").set(duplicateEmail).send({ consent: true, policyVersion })).status).toBe(409);
      expect((await api.delete("/api/account").set(other).send({ confirmation: "DELETE" })).status).toBe(200);
      expect((await api.get("/api/workspace").set(owner)).body.profile.id).toBe(one.profile.id);
      expect((await api.get("/api/workspace").set(other)).status).toBe(401);
      const invalid = headers("", "invalid@example.test");
      expect((await api.get("/api/session").set(invalid)).status).toBe(403);
      for (const oid of ["00000000-0000-0000-0000-000000000000", "not-a-guid"]) {
        expect((await api.get("/api/session").set(headers(oid, "invalid@example.test"))).status).toBe(403);
      }
      await runtime.store.database.query(
        `INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt","termsVersion")
         SELECT 'capacity-'||n, 'Test', 'capacity-'||n||'@example.test', true, now(), now(), $1 FROM generate_series(1,99) AS n`, [policyVersion]);
      expect((await api.post("/api/cloud-account").set(other).send({ consent: true, policyVersion })).status).toBe(429);
      expect((await api.post("/api/cloud-account").set(owner).send({ consent: true, policyVersion })).status).toBe(200);
    } finally { await runtime.close(); }
  });
});
