import express from "express";
import type { ErrorRequestHandler, RequestHandler } from "express";
import helmet from "helmet";
import multer from "multer";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { PGlite } from "@electric-sql/pglite";
import { PostgresDatabase } from "./database.js";
import {
  activitySchema, answerInputSchema, answerSchema, applicationSchema, applicationStates, connectionInputSchema,
  connectionSchema, documentSchema, idSchema, jobInputSchema, jobSchema, limits, packageSchema,
  preferenceSchema, profileUpdateSchema, voiceSchema, voiceUpdateSchema, workspaceSchema, z
} from "@applymate/contracts";
import { createIdentity } from "./auth.js";
import type { AuthConfig } from "./auth.js";
import type { Cipher } from "./crypto.js";
import { Store, metadata } from "./store.js";
import {
  ensureCandidate, getPreferences, getProfile, mergeResume, mergeSchema, normalize,
  parseResume, saveResume, saveVoice, updateProfile
} from "./candidate.js";
import { analyzeJob, importJob } from "./jobs.js";
import { Gateway } from "./gateway.js";
import { packageHash, Tailoring } from "./tailoring.js";
import { exportDocx, exportPdf } from "./exports.js";
import { AppError, requireCondition } from "./errors.js";
import { cloudIdentity } from "./cloud-identity.js";
import type { CloudConfig } from "./cloud-identity.js";
import { policyVersion } from "@applymate/contracts";

interface Identity { id: string; email: string; name: string; sessionCreatedAt: Date }
declare module "express-serve-static-core" {
  interface Locals { identity: Identity }
}
export interface AppConfig extends AuthConfig {
  directory?: string; cipher: Cipher; gateway?: Gateway; cloud?: CloudConfig; frontend?: string;
  databaseUrl?: string; databasePoolSize?: number;
}
const localHost = (hostname: string) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
const authRoutes = new Set([
  "/api/auth/email-otp/send-verification-otp", "/api/auth/sign-in/email-otp", "/api/auth/sign-out",
  "/api/auth/email-otp/request-email-change", "/api/auth/email-otp/change-email", "/api/auth/revoke-sessions"
]);
const preferencesInput = preferenceSchema.omit({ id: true, createdAt: true, updatedAt: true }).strict();
const changeInput = z.object({
  changes: z.array(z.object({
    id: idSchema, proposed: z.string().trim().min(1).max(2000), decision: z.enum(["pending", "approved", "rejected"])
  }).strict()).max(250)
}).strict();
const statusInput = z.object({
  state: z.enum(applicationStates), note: z.string().trim().min(5).max(1000),
  evidence: z.string().trim().max(2000).optional()
}).strict();

export async function createApp(config: AppConfig) {
  requireCondition(config.cloud ? config.origin.startsWith("https://") && config.origins.length === 1 && config.origins[0] === config.origin :
    config.origins.every((origin) => localHost(new URL(origin).hostname)) && localHost(new URL(config.origin).hostname),
    500, "LOCAL_ONLY", "This milestone is local-only. Public deployment requires the production release gates.");
  requireCondition(!config.databaseUrl || config.cloud, 500, "DATABASE_CONFIG",
    "External PostgreSQL is enabled only with trusted cloud identity; local OTP uses its isolated embedded database.");
  const database = config.databaseUrl ? new PostgresDatabase(config.databaseUrl, config.databasePoolSize) : new PGlite(config.directory);
  const store = new Store(database, config.cipher);
  try {
    await store.migrate(Boolean(config.cloud));
  }
  catch (error) { await database.close(); throw error; }
  let identity: ReturnType<typeof createIdentity>;
  try { identity = createIdentity(store, config.cipher, config); }
  catch (error) { await database.close(); throw error; }
  const gateway = config.gateway ?? new Gateway();
  const tailoring = new Tailoring(store, gateway);
  const app = express();
  const localOnly = !config.cloud;
  const mailMode = config.cloud ? "microsoft" as const : identity.mailMode;
  app.disable("x-powered-by");
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: config.cloud ? "same-origin" : "no-referrer" }
  }));
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (config.cloud ? req.hostname !== new URL(config.origin).hostname : !localHost(req.hostname)) return next(new AppError(403, "HOST_REJECTED", "This hostname is not allowed."));
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!config.origins.includes(req.get("origin") ?? "") || req.get("x-applymate-request") !== "1")) {
      return next(new AppError(403, "ORIGIN_REJECTED", "This action must come from your local ApplyMate workspace."));
    }
    next();
  });
  app.get("/api/health", (_req, res) => res.json({ status: "ok", product: "ApplyMate", localOnly }));
  app.get("/api/capabilities", (_req, res) => res.json({
    localOnly, mailMode, engine: "Evidence-only",
    automation: false, managedInbox: false, billing: false,
    limits: { documents: limits.documents, jobs: limits.jobs, dailyPackages: limits.dailyPackages }
  }));
  app.all("/api/auth/*splat", (req, _res, next) => {
    if (config.cloud) return next(new AppError(404, "AUTH_ROUTE", "Use the hosting platform's Microsoft sign-in and sign-out."));
    if (req.method !== "POST" || !authRoutes.has(req.path)) return next(new AppError(404, "AUTH_ROUTE", "This authentication operation is not enabled."));
    const length = Number(req.get("content-length"));
    if (!Number.isInteger(length) || length < 1 || length > 16384 || req.get("transfer-encoding")) {
      return next(new AppError(413, "AUTH_BODY_LIMIT", "Authentication requires a JSON request of at most 16 KB with a known length."));
    }
    next();
  }, toNodeHandler(identity.auth));
  app.use(express.json({ limit: "768kb", strict: true }));
  app.post("/api/local-mail", (req, res) => {
    requireCondition(!config.cloud && identity.mailMode === "local", 404, "NOT_AVAILABLE", "Local mail preview is not enabled.");
    const { email } = z.object({ email: z.email().max(254) }).strict().parse(req.body);
    const letter = identity.outbox.get(email.toLowerCase());
    requireCondition(letter && Date.parse(letter.expiresAt) > Date.now(), 404, "NO_LOCAL_MAIL", "There is no unexpired local code for this address. Request a new code.");
    res.json({ ...letter, notice: "Local development preview only. No email was delivered." });
  });
  app.get("/api/session", async (req, res) => {
    if (config.cloud) {
      if (!req.get("x-ms-client-principal")) return void res.json({ user: null, authenticated: false });
      const user = cloudIdentity(req, config.cloud);
      const result = await database.query<{ id: string }>('SELECT id FROM "user" WHERE id=$1 AND "termsVersion"=$2', [user.id, policyVersion]);
      return void res.json({ user: result.rows.length ? { id: user.id, email: user.email, name: user.name } : null, authenticated: true });
    }
    const session = await identity.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    res.json({ user: session ? { id: session.user.id, email: session.user.email, name: session.user.name } : null });
  });
  app.post("/api/cloud-account", async (req, res) => {
    requireCondition(config.cloud, 404, "NOT_AVAILABLE", "Microsoft pilot onboarding is not enabled.");
    z.object({ consent: z.literal(true), policyVersion: z.literal(policyVersion) }).strict().parse(req.body);
    const user = cloudIdentity(req, config.cloud);
    const created = await database.query<{ id: string }>(
      `INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt","termsVersion")
       SELECT $1,$2,$3,true,now(),now(),$4
       WHERE EXISTS (SELECT 1 FROM "user" WHERE id=$1) OR (SELECT count(*) FROM "user") < 100
       ON CONFLICT (id) DO UPDATE SET name=$2,email=$3,"updatedAt"=now(),"termsVersion"=$4 RETURNING id`,
      [user.id, user.name, user.email, policyVersion]);
    requireCondition(created.rows.length, 429, "PILOT_FULL", "This small test website has reached its 100-account limit. New signups are paused.");
    res.json({ saved: true });
  });
  const signedIn: RequestHandler = async (req, res, next) => {
    if (config.cloud) {
      const user = cloudIdentity(req, config.cloud);
      const result = await database.query<{ id: string }>('SELECT id FROM "user" WHERE id=$1 AND "termsVersion"=$2', [user.id, policyVersion]);
      requireCondition(result.rows.length, 401, "CONSENT_REQUIRED", "Acknowledge the pilot's data notice before creating your workspace.");
      res.locals.identity = user;
      return next();
    }
    const session = await identity.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    requireCondition(session && session.user.emailVerified, 401, "SIGN_IN_REQUIRED", "Sign in to your ApplyMate account to continue.");
    res.locals.identity = { id: session.user.id, email: session.user.email, name: session.user.name, sessionCreatedAt: session.session.createdAt };
    next();
  };
  const fresh: RequestHandler = (_req, res, next) => {
    requireCondition(Date.now() - res.locals.identity.sessionCreatedAt.getTime() <= 300000,
      403, "REAUTHENTICATE", config.cloud ?
        "For this sensitive action, use Verify Microsoft sign-in again in Settings, then retry within five minutes. Nothing was deleted." :
        "For this sensitive action, sign out and verify a new email code first.");
    next();
  };
  app.use("/api", signedIn);
  app.use("/api", async (req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      await store.consumeLimit(res.locals.identity.id, `write:${Math.floor(Date.now() / 60000)}`, 100);
    }
    next();
  });
  app.get("/api/workspace", async (_req, res) => {
    const user = res.locals.identity;
    await ensureCandidate(store, user.id, user.email);
    const [profile, preferences, voice, docs, jobs, packages, applications, answers, connections, activity] = await Promise.all([
      getProfile(store, user.id), getPreferences(store, user.id), store.list(user.id, "voice", voiceSchema, 1),
      store.list(user.id, "document", documentSchema), store.list(user.id, "job", jobSchema),
      store.list(user.id, "package", packageSchema), store.list(user.id, "application", applicationSchema),
      store.list(user.id, "answer", answerSchema), store.list(user.id, "connection", connectionSchema),
      store.list(user.id, "activity", activitySchema, 30)
    ]);
    res.json(workspaceSchema.parse({
      user, profile: profile.value, preferences: preferences.value, voice: voice[0]?.value ?? null,
      documents: docs.map(({ value }) => value), jobs: jobs.map(({ value }) => value),
      packages: packages.map(({ value }) => value),
      applications: applications.map(({ value }) => ({ ...value, title: value.snapshot.job.title, company: value.snapshot.job.company })),
      answers: answers.map(({ value }) => value), connections: connections.map(({ value }) => value),
      activity: activity.map(({ value }) => value),
      capabilities: {
        localOnly, mailMode, engine: "Evidence-only",
        automation: false, managedInbox: false, billing: false,
        limits: { documents: limits.documents, jobs: limits.jobs, dailyPackages: limits.dailyPackages }
      }
    }));
  });
  app.put("/api/profile", async (req, res) => {
    await updateProfile(store, res.locals.identity.id, profileUpdateSchema.parse(req.body));
    res.json({ saved: true });
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.uploadBytes, files: 1, fields: 0, parts: 1 } });
  app.post("/api/documents", upload.single("resume"), async (req, res) => {
    requireCondition(req.file, 400, "FILE_REQUIRED", "Choose a resume file to upload.");
    const document = await parseResume(req.file);
    res.status(201).json(await saveResume(store, res.locals.identity.id, document, req.file.buffer));
  });
  app.get("/api/documents/:id", async (req, res) => {
    res.json((await store.get(res.locals.identity.id, "document", idSchema.parse(req.params.id), documentSchema)).value);
  });
  app.get("/api/documents/:id/download", async (req, res) => {
    const owner = res.locals.identity.id;
    const id = idSchema.parse(req.params.id);
    const doc = (await store.get(owner, "document", id, documentSchema)).value;
    const bytes = Buffer.from(await store.getPrivate(owner, id, "binary"), "base64");
    res.set({ "Content-Type": doc.mime, "Content-Disposition": `attachment; filename="original-resume.${doc.mime === "application/pdf" ? "pdf" : doc.mime === "text/plain" ? "txt" : "docx"}"` }).send(bytes);
  });
  app.post("/api/documents/:id/merge", async (req, res) => {
    await mergeResume(store, res.locals.identity.id, idSchema.parse(req.params.id), mergeSchema.parse(req.body));
    res.json({ saved: true });
  });
  app.post("/api/voice", async (req, res) => res.status(201).json(await saveVoice(store, res.locals.identity.id, voiceUpdateSchema.parse(req.body))));
  app.get("/api/voice/versions", async (_req, res) => res.json((await store.list(res.locals.identity.id, "voice", voiceSchema)).map(({ value }) => value)));
  app.put("/api/preferences", async (req, res) => {
    const data = preferencesInput.parse(req.body);
    requireCondition(data.mode === "Review", 409, "AUTOMATION_DISABLED", "Hybrid and Auto execution are not enabled in this local milestone.");
    await store.transaction(async (tx) => {
      const owner = res.locals.identity.id;
      const current = await getPreferences(tx, owner);
      await tx.update(owner, "preferences", { ...current.value, ...data, updatedAt: new Date().toISOString() }, current.revision);
      const profile = await getProfile(tx, owner);
      if (profile.value.onboardingStep === "preferences") {
        await tx.update(owner, "profile", { ...profile.value, onboardingStep: "complete", revision: profile.value.revision + 1, updatedAt: new Date().toISOString() }, profile.revision);
      }
      await tx.event(owner, "Preferences saved", current.value.id, "Hard filters and the daily package limit apply before generation.");
    });
    res.json({ saved: true });
  });
  app.post("/api/answers", async (req, res) => {
    const input = answerInputSchema.parse(req.body);
    const sensitive = input.sensitivity === "sensitive" || /\b(visa|sponsor|sponsorship|authorized|salary|compensation|disability|gender|ethnicity|veteran|religion|criminal|social security)\b/i.test(input.question);
    requireCondition(!sensitive || (input.sensitivity === "sensitive" && input.reuse === "ask"), 400, "SENSITIVE_ANSWER", "Mark this answer sensitive and require confirmation before every reuse.");
    const owner = res.locals.identity.id;
    const saved = await store.transaction(async (tx) => {
      const existing = (await tx.list(owner, "answer", answerSchema)).find(({ value }) => value.normalizedQuestion === normalize(input.question));
      requireCondition(existing || await tx.count(owner, "answer") < 200, 409, "ANSWER_LIMIT", "The local workspace supports 200 saved questions.");
      const now = new Date().toISOString();
      const version = { version: (existing?.value.versions.length ?? 0) + 1, answer: input.answer, confirmedAt: now,
        source: "Explicit user confirmation", sensitivity: input.sensitivity, reuse: input.reuse };
      const answer = answerSchema.parse({
        ...(existing?.value ?? metadata()), question: input.question, normalizedQuestion: normalize(input.question),
        updatedAt: now, versions: [...(existing?.value.versions ?? []), version]
      });
      if (existing) await tx.update(owner, "answer", answer, existing.revision);
      else await tx.create(owner, "answer", answer);
      await tx.event(owner, "Answer confirmed", answer.id, "Versioned for future reuse. Existing application snapshots are unchanged.");
      return answer;
    });
    res.status(201).json(saved);
  });
  app.post("/api/jobs", async (req, res) => {
    const owner = res.locals.identity.id;
    res.status(201).json(await importJob(store, owner, jobInputSchema.parse(req.body), (await getProfile(store, owner)).value, (await getPreferences(store, owner)).value));
  });
  app.post("/api/jobs/:id/analyze", async (req, res) => {
    const owner = res.locals.identity.id;
    const row = await store.get(owner, "job", idSchema.parse(req.params.id), jobSchema);
    const updated = { ...row.value, analysis: analyzeJob(row.value, (await getProfile(store, owner)).value, (await getPreferences(store, owner)).value), updatedAt: new Date().toISOString() };
    await store.update(owner, "job", updated, row.revision);
    res.json(updated);
  });
  app.patch("/api/jobs/:id", async (req, res) => {
    const input = z.object({ state: z.enum(["saved", "dismissed"]), reason: z.string().trim().max(500) }).strict().parse(req.body);
    const owner = res.locals.identity.id;
    const row = await store.get(owner, "job", idSchema.parse(req.params.id), jobSchema);
    await store.update(owner, "job", { ...row.value, state: input.state, declineReason: input.reason, updatedAt: new Date().toISOString() }, row.revision);
    res.json({ saved: true });
  });
  app.post("/api/packages", async (req, res) => {
    const input = z.object({ jobId: idSchema, connectionId: idSchema.optional(), consent: z.literal(true).optional() }).strict().parse(req.body);
    requireCondition(!input.connectionId || input.consent, 400, "PROVIDER_CONSENT", "Confirm sharing this package with your selected AI provider before generation.");
    const pkg = await tailoring.create(res.locals.identity.id, input.jobId, input.connectionId);
    tailoring.kick();
    res.status(202).json(pkg);
  });
  app.get("/api/packages/:id", async (req, res) => res.json((await store.get(res.locals.identity.id, "package", idSchema.parse(req.params.id), packageSchema)).value));
  app.put("/api/packages/:id/review", async (req, res) => res.json(await tailoring.decisions(res.locals.identity.id, idSchema.parse(req.params.id), changeInput.parse(req.body).changes)));
  app.post("/api/packages/:id/approve", async (req, res) => {
    z.object({ acknowledged: z.literal(true) }).strict().parse(req.body);
    res.json(await tailoring.approve(res.locals.identity.id, idSchema.parse(req.params.id)));
  });
  app.get("/api/packages/:id/export/:kind/:format", async (req, res) => {
    const kind = z.enum(["resume", "cover"]).parse(req.params.kind);
    const format = z.enum(["pdf", "docx"]).parse(req.params.format);
    const pkg = (await store.get(res.locals.identity.id, "package", idSchema.parse(req.params.id), packageSchema)).value;
    const bytes = format === "pdf" ? await exportPdf(pkg, kind) : await exportDocx(pkg, kind);
    res.set({
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="applymate-${kind}-v${pkg.version}.${format}"`,
      "X-Document-Hash": pkg.hash
    }).send(bytes);
  });
  app.post("/api/applications", async (req, res) => {
    const { packageId } = z.object({ packageId: idSchema }).strict().parse(req.body);
    const owner = res.locals.identity.id;
    const saved = await store.transaction(async (tx) => {
      const pkg = (await tx.get(owner, "package", packageId, packageSchema)).value;
      requireCondition(pkg.state === "approved" && pkg.hash === packageHash(pkg), 409, "APPROVAL_REQUIRED", "Approve the exact, intact document version first.");
      requireCondition(!(await tx.list(owner, "application", applicationSchema)).some(({ value }) => value.jobId === pkg.jobId), 409, "DUPLICATE_APPLICATION", "An application for this job already exists. Open its timeline instead.");
      const answers = (await tx.list(owner, "answer", answerSchema)).flatMap(({ value }) => {
        const version = value.versions.at(-1);
        return version?.sensitivity === "standard" && version.reuse === "approved" ? [{ ...value, versions: [version] }] : [];
      });
      const appRecord = applicationSchema.parse({
        ...metadata(), jobId: pkg.jobId, packageId, state: "Human Action Required", snapshot: pkg, answers, evidence: null,
        timeline: [{ at: new Date().toISOString(), type: "Prepared", message: "An exact approved package was saved. No employer was contacted; submit manually and record confirmation." }]
      });
      await tx.create(owner, "application", appRecord);
      await tx.event(owner, "Application prepared", appRecord.id, "Waiting for you to apply. This is not a submitted application.");
      return appRecord;
    });
    res.status(201).json(saved);
  });
  app.get("/api/applications/:id", async (req, res) => res.json((await store.get(res.locals.identity.id, "application", idSchema.parse(req.params.id), applicationSchema)).value));
  app.patch("/api/applications/:id", async (req, res) => {
    const input = statusInput.parse(req.body);
    const owner = res.locals.identity.id;
    const row = await store.get(owner, "application", idSchema.parse(req.params.id), applicationSchema);
    const externalState = ["Submitted", "Under Review", "Assessment", "Interview", "Rejected", "Offer"].includes(input.state);
    requireCondition(!externalState || (input.evidence && input.evidence.length >= 15), 409, "EVIDENCE_REQUIRED", "Record the employer confirmation/reference (at least 15 characters). Updates are labeled user-reported, not independently verified.");
    const now = new Date().toISOString();
    const updated = applicationSchema.parse({
      ...row.value, state: input.state, updatedAt: now,
      evidence: externalState ? { kind: "User-reported confirmation", reference: input.evidence, at: now } : row.value.evidence,
      timeline: [...row.value.timeline, { at: now, type: "User-reported update", message: `${input.state}: ${input.note}`,
        ...(externalState ? { evidence: input.evidence } : {}) }]
    });
    requireCondition(updated.timeline.length <= 300, 409, "TIMELINE_LIMIT", "The local timeline limit is 300 entries.");
    await store.update(owner, "application", updated, row.revision);
    res.json(updated);
  });
  app.post("/api/connections", fresh, async (req, res) => {
    const input = connectionInputSchema.parse(req.body);
    const owner = res.locals.identity.id;
    requireCondition(await store.count(owner, "connection") < 5, 409, "CONNECTION_LIMIT", "Remove an old connection before adding more than five.");
    const connection = connectionSchema.parse({
      ...metadata(), provider: input.provider, model: input.model, suffix: input.apiKey.slice(-4),
      testedAt: null, status: "untested"
    });
    await store.transaction(async (tx) => {
      await tx.create(owner, "connection", connection);
      await tx.putPrivate(owner, connection.id, "key", input.apiKey);
      await tx.event(owner, "AI connection saved", connection.id, "Provider processing and possible charges explicitly acknowledged. Key stored encrypted; not tested yet.");
    });
    res.status(201).json(connection);
  });
  app.post("/api/connections/:id/test", fresh, async (req, res) => {
    const owner = res.locals.identity.id;
    const row = await store.get(owner, "connection", idSchema.parse(req.params.id), connectionSchema);
    try {
      await gateway.run(row.value, await store.getPrivate(owner, row.value.id, "key"), "Connection check. Return ok=true.", { test: true }, z.object({ ok: z.literal(true) }).strict());
      const updated = { ...row.value, status: "connected" as const, testedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await store.update(owner, "connection", updated, row.revision);
      res.json(updated);
    } catch (error) {
      await store.update(owner, "connection", { ...row.value, status: "failed", testedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, row.revision);
      throw error;
    }
  });
  app.delete("/api/connections/:id", fresh, async (req, res) => {
    await store.remove(res.locals.identity.id, "connection", idSchema.parse(req.params.id));
    res.json({ removed: true });
  });
  app.get("/api/account/export", async (_req, res) => {
    const owner = res.locals.identity.id;
    const data = {
      exportedAt: new Date().toISOString(), account: { email: res.locals.identity.email },
      profile: (await getProfile(store, owner)).value,
      preferences: (await getPreferences(store, owner)).value,
      voices: (await store.list(owner, "voice", voiceSchema)).map(({ value }) => value),
      documents: (await store.list(owner, "document", documentSchema)).map(({ value }) => value),
      jobs: (await store.list(owner, "job", jobSchema)).map(({ value }) => value),
      packages: (await store.list(owner, "package", packageSchema)).map(({ value }) => value),
      applications: (await store.list(owner, "application", applicationSchema)).map(({ value }) => value),
      answers: (await store.list(owner, "answer", answerSchema)).map(({ value }) => value)
    };
    res.set("Content-Disposition", 'attachment; filename="applymate-data.json"').json(data);
  });
  app.delete("/api/account", fresh, async (req, res) => {
    z.object({ confirmation: z.literal("DELETE") }).strict().parse(req.body);
    const owner = res.locals.identity.id;
    identity.outbox.delete(res.locals.identity.email.toLowerCase());
    await store.deleteUser(owner);
    res.json({ deleted: true });
  });
  app.use("/api", (_req, _res, next) => next(new AppError(404, "NOT_FOUND", "This operation is not available.")));
  if (config.frontend) app.use(express.static(config.frontend, { index: "index.html" }));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) return _next(error);
    if (error instanceof AppError) return void res.status(error.status).json({ error: { code: error.code, message: error.message } });
    if (error instanceof z.ZodError) return void res.status(400).json({ error: { code: "VALIDATION", message: error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "Input"}: ${issue.message}`).join(" ") } });
    if (error instanceof multer.MulterError) return void res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: { code: "UPLOAD_LIMIT", message: "Upload exactly one PDF, DOCX, or TXT file under 5 MB." } });
    if (error instanceof Error && "type" in error && error.type === "entity.too.large") return void res.status(413).json({ error: { code: "BODY_LIMIT", message: "This request exceeds the local size limit." } });
    if (error instanceof SyntaxError) return void res.status(400).json({ error: { code: "INVALID_JSON", message: "The request must contain valid JSON." } });
    console.error("[ApplyMate] API operation failed. Request content and credentials were not recorded.");
    res.status(500).json({ error: { code: "INTERNAL", message: "The operation could not be completed. Refresh to check the last saved state before retrying." } });
  };
  app.use(errors);
  try { await tailoring.recover(); }
  catch (error) { identity.close(); await database.close(); throw error; }
  return { app, store, identity, tailoring, close: async () => { await tailoring.stop(); identity.close(); await database.close(); } };
}
