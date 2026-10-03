import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { expect, it } from "vitest";
import { policyVersion, workspaceSchema, z } from "@applymate/contracts";
import { createApp } from "./app.js";
import { loadCipher } from "./crypto.js";
import { sampleResume } from "./fixtures.js";

it("keeps a real authenticated account and resume available after a disk-backed restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "applymate-restart-test-"));
  const origin = "http://127.0.0.1:4175";
  const email = "restart@example.test";
  let runtime: Awaited<ReturnType<typeof createApp>> | undefined;
  const start = async () => createApp({
    directory: join(directory, "postgres"), cipher: await loadCipher(directory), origin, origins: [origin]
  });
  try {
    runtime = await start();
    const agent = request.agent(runtime.app);
    const post = (path: string) => agent.post(path).set("Origin", origin).set("X-Applymate-Request", "1");
    expect((await post("/api/auth/email-otp/send-verification-otp").send({ email, type: "sign-in" })).status).toBe(200);
    const code = runtime.identity.outbox.get(email)!.code;
    const verified = await post("/api/auth/sign-in/email-otp").set("X-Applymate-Consent", policyVersion).send({ email, otp: code });
    expect(verified.status).toBe(200);
    const cookies = z.array(z.string()).parse(verified.headers["set-cookie"]).map((cookie) => cookie.split(";")[0]).join("; ");
    const before = workspaceSchema.parse((await agent.get("/api/workspace")).body);
    const uploaded = await post("/api/documents").attach("resume", Buffer.from(sampleResume), "synthetic-persistent-resume.txt");
    expect(uploaded.status).toBe(201);
    const previous = runtime;
    runtime = undefined;
    await previous.close();
    runtime = await start();
    expect(runtime.identity.outbox.size).toBe(0);
    const restored = await request(runtime.app).get("/api/workspace").set("Cookie", cookies);
    expect(restored.status).toBe(200);
    const data = workspaceSchema.parse(restored.body);
    expect(data.user.id).toBe(before.user.id);
    expect(data.user.email).toBe(email);
    expect(data.profile.fields.fullName.value).toBe("Taylor Reed");
    expect(data.documents.map((document) => document.id)).toEqual([uploaded.body.document.id]);
    const original = await request(runtime.app).get(`/api/documents/${uploaded.body.document.id}/download`).set("Cookie", cookies);
    expect(original.status).toBe(200);
    expect(original.text).toBe(sampleResume);
  } finally {
    await runtime?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
