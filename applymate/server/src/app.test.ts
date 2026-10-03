import { randomBytes } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Agent } from "supertest";
import { policyVersion, workspaceSchema, packageSchema, voicePrompts, applicationSchema, preferenceSchema, documentSchema, z } from "@applymate/contracts";
import { createApp } from "./app.js";
import { Cipher } from "./crypto.js";
import { fixturePackage, sampleResume, sampleJob, writingSample } from "./fixtures.js";
import { Gateway } from "./gateway.js";
import type { Transport } from "./gateway.js";
import { metadata } from "./store.js";

const origin = "http://localhost:4174";
let runtime: Awaited<ReturnType<typeof createApp>>;
let owner: Agent;
let other: Agent;
let checkerPasses = true;
const transport = vi.fn<Transport>(async (_url, options) => {
  const input = z.object({ input: z.array(z.object({ role: z.string(), content: z.string() })) }).parse(JSON.parse(String(options?.body))).input;
  const instruction = input[0].content;
  let result: unknown;
  if (instruction.includes("Connection check.")) result = { ok: true };
  else if (instruction.includes("independent factual and authenticity checker")) {
    result = { factuallySupported: checkerPasses, authentic: true, findings: checkerPasses ? [] : ["Synthetic independent checker rejection."] };
  } else {
    const data = z.object({ facts: z.array(z.object({ id: z.string(), text: z.string() })) }).parse(JSON.parse(input[1].content));
    result = { statements: data.facts.map((fact) => ({ factId: fact.id, text: fact.text })) };
  }
  return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }] });
});

function post(agent: Agent, path: string) {
  return agent.post(path).set("Origin", origin).set("X-Applymate-Request", "1");
}
function put(agent: Agent, path: string) {
  return agent.put(path).set("Origin", origin).set("X-Applymate-Request", "1");
}
async function signIn(email: string) {
  const agent = request.agent(runtime.app);
  const sent = await post(agent, "/api/auth/email-otp/send-verification-otp").send({ email, type: "sign-in" });
  expect(sent.status, sent.body.message).toBe(200);
  const code = runtime.identity.outbox.get(email)!.code;
  const response = await post(agent, "/api/auth/sign-in/email-otp").set("X-Applymate-Consent", policyVersion).send({ email, otp: code });
  expect(response.status, response.body.message).toBe(200);
  const workspace = await agent.get("/api/workspace");
  expect(workspace.status).toBe(200);
  return { agent, code };
}
async function workspace(agent: Agent) {
  const response = await agent.get("/api/workspace");
  expect(response.status).toBe(200);
  return workspaceSchema.parse(response.body);
}
async function settled(agent: Agent, id: string) {
  for (let count = 0; count < 100; count++) {
    const response = await agent.get(`/api/packages/${id}`);
    expect(response.status).toBe(200);
    const pkg = packageSchema.parse(response.body);
    if (!["queued", "generating", "reviewing"].includes(pkg.state)) return pkg;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("The local package did not finish within the test time limit.");
}
async function readyProfile(agent: Agent) {
  const uploaded = await post(agent, "/api/documents").attach("resume", Buffer.from(sampleResume), { filename: "fictional-resume.txt", contentType: "text/plain" });
  expect(uploaded.status, uploaded.body.error?.message).toBe(201);
  let data = await workspace(agent);
  expect(data.profile.facts.every((fact) => fact.state === "proposed")).toBe(true);
  const saved = await put(agent, "/api/profile").send({
    revision: data.profile.revision, fields: Object.fromEntries(Object.entries(data.profile.fields).map(([key, field]) => [key, field.value])),
    facts: data.profile.facts.map(({ id, text, category }) => ({ id, text, category, state: "verified" })), confirm: true
  });
  expect(saved.status, saved.body.error?.message).toBe(200);
  const voice = await post(agent, "/api/voice").send({
    answers: voicePrompts.slice(0, 3).map((prompt) => ({ promptId: prompt.id, text: writingSample })),
    polish: "Preserve My Style", preferredPhrases: [], bannedPhrases: ["synergy"]
  });
  expect(voice.status, voice.body.error?.message).toBe(201);
  expect(voice.body.complete).toBe(true);
  data = await workspace(agent);
  const preferences = preferenceSchema.omit({ id: true, createdAt: true, updatedAt: true }).parse(data.preferences);
  expect((await put(agent, "/api/preferences").send(preferences)).status).toBe(200);
  return uploaded.body.document.id as string;
}

beforeAll(async () => {
  runtime = await createApp({ cipher: new Cipher(randomBytes(32)), origin, origins: [origin], rateLimit: 100, gateway: new Gateway(transport) });
  owner = (await signIn("owner@example.test")).agent;
  other = (await signIn("other@example.test")).agent;
}, 30000);
afterAll(async () => { await runtime?.close(); });

describe("real passwordless identity", () => {
  it("requires authentication, origin checks, and explicit consent", async () => {
    expect((await request(runtime.app).get("/api/workspace")).status).toBe(401);
    expect((await request(runtime.app).post("/api/auth/sign-out").send({})).status).toBe(403);
    const sent = await post(owner, "/api/auth/email-otp/send-verification-otp").send({ email: "consent@example.test", type: "sign-in" });
    expect(sent.status).toBe(200);
    const code = runtime.identity.outbox.get("consent@example.test")!.code;
    expect((await post(owner, "/api/auth/sign-in/email-otp").send({ email: "consent@example.test", otp: code })).status).toBe(400);
    expect((await request(runtime.app).get("/api/health").set("Host", "attacker.example")).status).toBe(403);
  });
  it("rejects OTP replay and exhausts invalid attempts", async () => {
    const { code } = await signIn("replay@example.test");
    const repeated = await post(owner, "/api/auth/sign-in/email-otp").set("X-Applymate-Consent", policyVersion).send({ email: "replay@example.test", otp: code });
    expect(repeated.status).toBeGreaterThanOrEqual(400);
    await post(owner, "/api/auth/email-otp/send-verification-otp").send({ email: "attempts@example.test", type: "sign-in" });
    const valid = runtime.identity.outbox.get("attempts@example.test")!.code;
    for (let index = 0; index < 6; index++) {
      const response = await post(owner, "/api/auth/sign-in/email-otp").set("X-Applymate-Consent", policyVersion).send({
        email: "attempts@example.test", otp: valid === "000000" ? "111111" : "000000"
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    const exhausted = await post(owner, "/api/auth/sign-in/email-otp").set("X-Applymate-Consent", policyVersion).send({ email: "attempts@example.test", otp: valid });
    expect(exhausted.status).toBeGreaterThanOrEqual(400);
  });
});

describe("resume-first integrated milestone", () => {
  it("persists proposed facts, voice, evidence, immutable exports, and a truthful application", async () => {
    const documentId = await readyProfile(owner);
    expect((await other.get(`/api/documents/${documentId}`)).status).toBe(404);
    expect((await other.get(`/api/documents/${documentId}/download`)).status).toBe(404);
    const duplicate = await post(owner, "/api/documents").attach("resume", Buffer.from(sampleResume), "same.txt");
    expect(duplicate.status).toBe(409);
    const imported = await post(owner, "/api/jobs").send(sampleJob);
    expect(imported.status, imported.body.error?.message).toBe(201);
    expect(imported.body.analysis.requirements.length).toBeGreaterThan(0);
    expect((await post(owner, "/api/jobs").send(sampleJob)).status).toBe(409);
    expect((await post(other, "/api/packages").send({ jobId: imported.body.id })).status).toBe(404);
    const queued = await post(owner, "/api/packages").send({ jobId: imported.body.id });
    expect(queued.status, queued.body.error?.message).toBe(202);
    let pkg = packageSchema.parse(queued.body);
    pkg = await settled(owner, pkg.id);
    expect(pkg.state, JSON.stringify(pkg.reviews)).toBe("needs_review");
    expect(pkg.reviews).toHaveLength(3);
    expect((await owner.get(`/api/packages/${pkg.id}/export/resume/pdf`)).status).toBe(409);
    expect((await post(owner, `/api/packages/${pkg.id}/approve`).send({ acknowledged: true })).status).toBe(409);
    const decisions = await put(owner, `/api/packages/${pkg.id}/review`).send({
      changes: pkg.changes.map(({ id, proposed }) => ({ id, proposed, decision: "approved" }))
    });
    expect(decisions.status, decisions.body.error?.message).toBe(200);
    const approved = await post(owner, `/api/packages/${pkg.id}/approve`).send({ acknowledged: true });
    expect(approved.status, approved.body.error?.message).toBe(200);
    pkg = packageSchema.parse(approved.body);
    expect(pkg.hash).toHaveLength(64);
    expect((await other.get(`/api/packages/${pkg.id}`)).status).toBe(404);
    expect((await put(owner, `/api/packages/${pkg.id}/review`).send({ changes: [] })).status).toBe(409);
    for (const format of ["pdf", "docx"]) {
      const exported = await owner.get(`/api/packages/${pkg.id}/export/resume/${format}`);
      expect(exported.status).toBe(200);
      expect(exported.headers["x-document-hash"]).toBe(pkg.hash);
      expect(Number(exported.headers["content-length"])).toBeGreaterThan(1000);
    }
    const answer = { question: "How do you approach a project?", answer: "Earlier private answer.", sensitivity: "sensitive", reuse: "ask" };
    expect((await post(owner, "/api/answers").send(answer)).status).toBe(201);
    const reusable = { ...answer, answer: "I start with a small example and ask for feedback.", sensitivity: "standard", reuse: "approved" };
    expect((await post(owner, "/api/answers").send(reusable)).status).toBe(201);
    expect((await post(owner, "/api/answers").send({ ...reusable, question: "Do you require visa sponsorship?" })).status).toBe(400);
    const created = await post(owner, "/api/applications").send({ packageId: pkg.id });
    expect(created.status, created.body.error?.message).toBe(201);
    const application = applicationSchema.parse(created.body);
    expect(application.state).toBe("Human Action Required");
    expect(application.evidence).toBeNull();
    expect(application.snapshot.hash).toBe(pkg.hash);
    expect(application.answers).toHaveLength(1);
    expect(application.answers[0].versions).toHaveLength(1);
    expect(application.answers[0].versions[0]).toMatchObject({ version: 2, answer: reusable.answer });
    expect(JSON.stringify(application.answers)).not.toContain(answer.answer);
    expect((await post(owner, "/api/answers").send({ ...answer, answer: "A later private version." })).status).toBe(201);
    expect((await post(owner, "/api/applications").send({ packageId: pkg.id })).status).toBe(409);
    expect((await other.get(`/api/applications/${application.id}`)).status).toBe(404);
    const noEvidence = await owner.patch(`/api/applications/${application.id}`).set("Origin", origin).set("X-Applymate-Request", "1").send({ state: "Submitted", note: "I clicked the button." });
    expect(noEvidence.status).toBe(409);
    const firstEvidence = "Employer confirmation reference EXAMPLE-100.";
    const reported = await owner.patch(`/api/applications/${application.id}`).set("Origin", origin).set("X-Applymate-Request", "1")
      .send({ state: "Submitted", note: "n".repeat(1000), evidence: firstEvidence });
    expect(reported.status, reported.body.error?.message).toBe(200);
    const secondEvidence = "Employer interview invitation reference EXAMPLE-200.";
    const interviewed = await owner.patch(`/api/applications/${application.id}`).set("Origin", origin).set("X-Applymate-Request", "1")
      .send({ state: "Interview", note: "I received an interview invitation.", evidence: secondEvidence });
    expect(interviewed.status, interviewed.body.error?.message).toBe(200);
    const history = applicationSchema.parse(interviewed.body);
    expect(history.timeline.map((entry) => entry.evidence)).toEqual([undefined, firstEvidence, secondEvidence]);
    expect(history.evidence?.reference).toBe(secondEvidence);
    expect(history.snapshot.hash).toBe(pkg.hash);
    expect(history.answers).toEqual(application.answers);
    const data = await workspace(owner);
    expect(data.applications).toHaveLength(1);
    expect(data.profile.facts.every((fact) => fact.source.excerpt)).toBe(true);
    const raw = await runtime.store.database.query<{ payload: string }>("SELECT payload FROM objects WHERE kind = 'profile'");
    expect(raw.rows.every((row) => !row.payload.includes("Taylor Reed") && row.payload.startsWith("v1:"))).toBe(true);
  }, 30000);
  it("rejects oversized and disguised uploads without creating a profile", async () => {
    const disguised = await post(other, "/api/documents").attach("resume", Buffer.from(sampleResume), "disguised.pdf");
    expect(disguised.status).toBe(415);
    const oversized = await post(other, "/api/documents").attach("resume", Buffer.alloc(5 * 1024 * 1024 + 1, "a"), "oversized.txt");
    expect(oversized.status).toBe(413);
    expect((await workspace(other)).profile.documentIds).toHaveLength(0);
  });

  it("requires an explicit, revision-safe resume merge and preserves unselected verified facts", async () => {
    const agent = (await signIn("merge@example.test")).agent;
    await readyProfile(agent);
    const before = (await workspace(agent)).profile;
    const revised = sampleResume.replace("Taylor Reed", "Taylor Example") + "\nBuilt an accessible React search form.";
    const uploaded = await post(agent, "/api/documents").attach("resume", Buffer.from(revised), "updated-resume.txt");
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.mergeRequired).toBe(true);
    const document = documentSchema.parse(uploaded.body.document);
    expect((await workspace(agent)).profile.fields).toEqual(before.fields);
    expect((await workspace(agent)).profile.facts).toEqual(before.facts);
    const added = document.proposedFacts.find((fact) => fact.text.includes("search form"))!;
    const selection = { revision: before.revision, fields: ["fullName"], factIds: [added.id] };
    expect((await post(other, `/api/documents/${document.id}/merge`).send(selection)).status).toBe(404);
    expect((await post(agent, `/api/documents/${document.id}/merge`).send({ ...selection, revision: "old" })).status).toBe(400);
    const stale = await post(agent, `/api/documents/${document.id}/merge`).send({ ...selection, revision: before.revision - 1 });
    expect(stale.status).toBe(409);
    const merged = await post(agent, `/api/documents/${document.id}/merge`).send(selection);
    expect(merged.status, merged.body.error?.message).toBe(200);
    const after = (await workspace(agent)).profile;
    expect(after.fields.fullName).toMatchObject({ value: "Taylor Example", state: "proposed" });
    expect(after.fields.email).toEqual(before.fields.email);
    expect(after.facts.filter((fact) => before.facts.some((original) => original.id === fact.id))).toEqual(before.facts);
    expect(after.facts.find((fact) => fact.text === added.text)?.state).toBe("proposed");
    expect((await post(agent, `/api/documents/${document.id}/merge`).send(selection)).status).toBe(409);
  });

  it("enforces per-generation consent and an independent checker with a mocked BYOK provider", async () => {
    const agent = (await signIn("byok@example.test")).agent;
    await readyProfile(agent);
    const imported = await post(agent, "/api/jobs").send(sampleJob);
    expect(imported.status).toBe(201);
    const fakeKey = "synthetic-byok-test-key-only";
    const connection = await post(agent, "/api/connections").send({ provider: "openai", model: "fixture-model", apiKey: fakeKey, consent: true });
    expect(connection.status, connection.body.error?.message).toBe(201);
    expect(JSON.stringify(connection.body)).not.toContain(fakeKey);
    const creation = { jobId: imported.body.id, connectionId: connection.body.id };
    const untested = await post(agent, "/api/packages").send({ ...creation, consent: true });
    expect(untested.body.error?.code).toBe("PROVIDER_NOT_TESTED");
    expect((await post(other, `/api/connections/${connection.body.id}/test`).send({})).status).toBe(404);
    expect((await post(agent, `/api/connections/${connection.body.id}/test`).send({})).status).toBe(200);
    const calls = transport.mock.calls.length;
    const unconsented = await post(agent, "/api/packages").send(creation);
    expect(unconsented.body.error?.code).toBe("PROVIDER_CONSENT");
    expect(transport.mock.calls).toHaveLength(calls);
    const queued = await post(agent, "/api/packages").send({ ...creation, consent: true });
    expect(queued.status).toBe(202);
    let pkg = await settled(agent, queued.body.id);
    expect(pkg.state, pkg.error).toBe("needs_review");
    expect(pkg.reviews).toHaveLength(4);
    expect(transport.mock.calls).toHaveLength(calls + 2);
    expect(transport.mock.calls.slice(calls).every(([, options]) => !String(options?.body).includes(fakeKey))).toBe(true);
    const duplicate = await post(agent, "/api/packages").send({ ...creation, consent: true });
    expect(duplicate.body.id).toBe(pkg.id);
    expect(transport.mock.calls).toHaveLength(calls + 2);
    expect((await put(agent, `/api/packages/${pkg.id}/review`).send({
      changes: pkg.changes.map(({ id, proposed }) => ({ id, proposed, decision: "approved" }))
    })).status).toBe(200);
    expect((await post(agent, `/api/packages/${pkg.id}/approve`).send({ acknowledged: true })).status).toBe(200);
    checkerPasses = false;
    try {
      const blocked = await post(agent, "/api/packages").send({ ...creation, consent: true });
      expect(blocked.status).toBe(202);
      pkg = await settled(agent, blocked.body.id);
      expect(pkg.state).toBe("blocked");
      expect(pkg.reviews.find((review) => review.reviewer === "Independent model reviewer")?.status).toBe("fail");
      expect((await post(agent, `/api/packages/${pkg.id}/approve`).send({ acknowledged: true })).status).toBe(409);
      expect((await agent.get(`/api/packages/${pkg.id}/export/resume/pdf`)).status).toBe(409);
    } finally { checkerPasses = true; }
    const exported = await agent.get("/api/account/export");
    expect(exported.status).toBe(200);
    expect(JSON.stringify(exported.body)).not.toContain(fakeKey);
    expect(exported.body).not.toHaveProperty("connections");
    expect(exported.body).not.toHaveProperty("sessions");
  });

  it("requires fresh authentication for key changes and account deletion, then removes owned data", async () => {
    let agent = (await signIn("deletion@example.test")).agent;
    const documentId = await readyProfile(agent);
    const data = await workspace(agent);
    const connection = await post(agent, "/api/connections").send({
      provider: "openai", model: "fixture-model", apiKey: "synthetic-deletion-test-key", consent: true
    });
    expect(connection.status).toBe(201);
    await runtime.store.database.query(`UPDATE session SET "createdAt" = now() - interval '10 minutes' WHERE "userId" = $1`, [data.user.id]);
    const remove = () => agent.delete("/api/account").set("Origin", origin).set("X-Applymate-Request", "1").send({ confirmation: "DELETE" });
    expect((await remove()).body.error?.code).toBe("REAUTHENTICATE");
    const keyChange = await agent.delete(`/api/connections/${connection.body.id}`).set("Origin", origin).set("X-Applymate-Request", "1");
    expect(keyChange.body.error?.code).toBe("REAUTHENTICATE");
    expect((await post(agent, "/api/auth/sign-out").send({})).status).toBe(200);
    agent = (await signIn("deletion@example.test")).agent;
    expect((await remove()).status).toBe(200);
    expect((await agent.get("/api/workspace")).status).toBe(401);
    expect(await runtime.store.count(data.user.id, "profile")).toBe(0);
    expect(await runtime.store.count(data.user.id, "connection")).toBe(0);
    await expect(runtime.store.getPrivate(data.user.id, documentId, "binary")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(runtime.identity.outbox.has("deletion@example.test")).toBe(false);
    expect((await workspace(owner)).applications).toHaveLength(1);
  });

  it("recovers a queued package but does not repeat interrupted provider work", async () => {
    const agent = (await signIn("recovery@example.test")).agent;
    const data = await workspace(agent);
    const pending = fixturePackage();
    const ids: string[] = [];
    for (const state of ["queued", "generating", "reviewing"] as const) {
      const pkg = { ...pending, ...metadata(), state, approvedAt: null, hash: "", changes: [], reviews: [],
        engine: state === "queued" ? "Evidence-only local" : `openai:${metadata().id}:fixture-model` };
      ids.push(pkg.id);
      await runtime.store.create(data.user.id, "package", pkg);
    }
    const calls = transport.mock.calls.length;
    await runtime.tailoring.recover();
    expect((await settled(agent, ids[0])).state).toBe("needs_review");
    for (const id of ids.slice(1)) {
      const pkg = await settled(agent, id);
      expect(pkg.state).toBe("failed");
      expect(pkg.error).toContain("server restarted");
    }
    expect(transport.mock.calls).toHaveLength(calls);
  });
});
