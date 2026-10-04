import { randomBytes } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { policyVersion } from "@applymate/contracts";
import { createApp } from "./app.js";
import { Cipher } from "./crypto.js";

const origin = "https://applymate-test.azurewebsites.net";
const cloud = { tenant: "test-tenant", objectId: "test-owner" };
function principal(oid = cloud.objectId, issued = Math.floor(Date.now() / 1000)) {
  return Buffer.from(JSON.stringify({
    auth_typ: "aad", claims: [
      { typ: "tid", val: cloud.tenant }, { typ: "oid", val: oid },
      { typ: "preferred_username", val: "pilot@example.test" },
      { typ: "name", val: "Pilot Test" }, { typ: "iat", val: String(issued) }
    ]
  })).toString("base64");
}

describe("Azure owner-restricted pilot", () => {
  it("requires platform identity and explicit consent, persists owned records and disables local authentication", async () => {
    const runtime = await createApp({ cipher: new Cipher(randomBytes(32)), origin, origins: [origin], cloud });
    try {
      const api = request(runtime.app);
      const headers = { Host: new URL(origin).host, Origin: origin, "X-Applymate-Request": "1", "X-MS-CLIENT-PRINCIPAL": principal() };
      expect((await api.get("/api/session").set("Host", new URL(origin).host)).status).toBe(401);
      expect((await api.get("/api/session").set(headers).set("X-MS-CLIENT-PRINCIPAL", principal("other-owner"))).status).toBe(403);
      expect((await api.get("/api/session").set(headers)).body.user).toBeNull();
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
      expect((await api.get("/api/workspace").set(headers)).status).toBe(200);
      expect((await api.delete("/api/account").set(headers).send({ confirmation: "delete" })).status).toBe(400);
      expect((await api.delete("/api/account").set(headers).send({ confirmation: "DELETE" })).status).toBe(200);
      expect((await api.get("/api/session").set(headers)).body.user).toBeNull();
      expect((await api.get("/api/workspace").set(headers)).status).toBe(401);
    } finally { await runtime.close(); }
  });
});
