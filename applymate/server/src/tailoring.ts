import { setImmediate } from "node:timers/promises";
import {
  packageSchema, voiceSchema, jobSchema, connectionSchema, changeSchema, z
} from "@applymate/contracts";
import type { ApplicationPackage, Change, Connection } from "@applymate/contracts";
import { getPreferences, getProfile } from "./candidate.js";
import { analyzeJob, keywords } from "./jobs.js";
import { AppError, requireCondition, safeFailure } from "./errors.js";
import { digest } from "./crypto.js";
import { metadata } from "./store.js";
import type { Store } from "./store.js";
import type { Gateway } from "./gateway.js";
import { runReviewers } from "./reviews.js";

const generatedSchema = z.object({
  statements: z.array(z.object({ factId: z.string(), text: z.string().min(1).max(2000) }).strict()).min(1).max(250)
}).strict();
const checkedSchema = z.object({
  factuallySupported: z.boolean(), authentic: z.boolean(), findings: z.array(z.string().max(1000)).max(15)
}).strict();

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function packageHash(pkg: ApplicationPackage): string { return digest(stableJson({ ...pkg, hash: "" })); }
export function coverLetter(pkg: ApplicationPackage): string {
  const selected = pkg.changes.filter((change) => change.decision !== "rejected");
  const relevant = selected.filter((change) => change.keywords.length);
  const examples = (relevant.length ? relevant : selected).slice(0, 3).map((change) => change.proposed);
  const introduction = pkg.voice.polish === "Highly Polished" ?
    `I am writing to express my interest in the ${pkg.job.title} position at ${pkg.job.company}.` :
    `I'm interested in the ${pkg.job.title} role at ${pkg.job.company}.`;
  return `Dear hiring team,\n\n${introduction}\n\nHere is experience I can support:\n\n${examples.join("\n\n")}\n\nThank you for considering my application. I would welcome a conversation about the role.\n\n${pkg.candidate.fullName}`;
}
export function generateLocally(pkg: ApplicationPackage): Change[] {
  const wanted = new Set(pkg.job.analysis.requirements.flatMap((requirement) => requirement.keywords));
  const order = ["summary", "skill", "experience", "project", "achievement", "education", "certification", "other"];
  return pkg.facts.map((fact) => {
    const matches = keywords(fact.text).filter((keyword) => wanted.has(keyword));
    return changeSchema.parse({
      id: metadata().id, factId: fact.id, section: fact.category,
      original: fact.text, proposed: fact.text, decision: "pending",
      keywords: matches,
      reason: matches.length ? `Verified ${matches.join(", ")} evidence is highlighted without adding claims.` :
        "Preserves a verified statement and its provenance. Exclude it if it is not relevant to this role."
    });
  }).sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
}

export class Tailoring {
  private running: Promise<void> | null = null;
  private stopping = false;
  private requested = false;
  constructor(private readonly store: Store, private readonly gateway: Gateway) {}

  async create(owner: string, jobId: string, connectionId?: string): Promise<ApplicationPackage> {
    return this.store.transaction(async (tx) => {
      const profile = (await getProfile(tx, owner)).value;
      const preferences = (await getPreferences(tx, owner)).value;
      const job = (await tx.get(owner, "job", jobId, jobSchema)).value;
      const voice = (await tx.list(owner, "voice", voiceSchema, 1))[0]?.value;
      requireCondition(profile.documentIds.length, 409, "RESUME_REQUIRED", "Upload and confirm a resume first.");
      requireCondition(profile.fields.fullName.state === "verified" && profile.fields.email.state === "verified", 409, "CONFIRM_PROFILE", "Confirm your name and contact email first.");
      requireCondition(voice?.complete, 409, "VOICE_REQUIRED", "Save at least three writing samples totaling 80 words before tailoring.");
      const analysis = analyzeJob(job, profile, preferences);
      requireCondition(job.state === "saved" && !analysis.hardFilters.length, 409, "HARD_FILTER", analysis.hardFilters[0] ?? "Reopen this job before tailoring.");
      const facts = profile.facts.filter((fact) => fact.state === "verified");
      requireCondition(facts.length, 409, "FACTS_REQUIRED", "Confirm at least one career fact first.");
      let connection: Connection | undefined;
      if (connectionId) {
        connection = (await tx.get(owner, "connection", connectionId, connectionSchema)).value;
        requireCondition(connection.status === "connected", 409, "PROVIDER_NOT_TESTED", "Test your AI connection before using it.");
      }
      const existing = await tx.list(owner, "package", packageSchema);
      requireCondition(existing.length < 200, 409, "PACKAGE_LIMIT", "The local workspace supports up to 200 packages.");
      const engine = connection ? `${connection.provider}:${connection.id}:${connection.model}` : "Evidence-only local";
      const duplicate = existing.find(({ value }) => value.jobId === jobId && value.profileRevision === profile.revision &&
        value.voiceId === voice.id && value.engine === engine && !["failed", "blocked", "approved"].includes(value.state));
      if (duplicate) return duplicate.value;
      await tx.consumeLimit(owner, `tailoring:${new Date().toISOString().slice(0, 10)}`, preferences.dailyLimit);
      const pkg = packageSchema.parse({
        ...metadata(), jobId, sourceDocumentId: profile.documentIds.at(-1), profileRevision: profile.revision,
        voiceId: voice.id, version: existing.filter(({ value }) => value.jobId === jobId).length + 1,
        state: "queued", engine, error: "",
        candidate: Object.fromEntries(["fullName", "email", "phone", "location", "headline", "website"].map((key) => {
          const field = profile.fields[key as keyof typeof profile.fields];
          return [key, field.state === "verified" ? field.value : ""];
        })),
        facts, voice, job: { ...job, analysis }, changes: [], reviews: [], coverLetter: "", approvedAt: null, hash: ""
      });
      await tx.create(owner, "package", pkg);
      await tx.event(owner, "Tailoring queued", pkg.id, "A durable local job was created. Review is mandatory; nothing will be submitted.");
      return pkg;
    });
  }

  kick(): void {
    this.requested = true;
    if (this.running || this.stopping) return;
    this.running = this.drain().catch(() => {
      console.error("[ApplyMate] Local tailoring queue failed. No candidate data recorded.");
    }).finally(() => {
      this.running = null;
      if (this.requested && !this.stopping) this.kick();
    });
  }
  async recover(): Promise<void> {
    for (const task of await this.store.queued()) {
      if (task.state !== "queued") {
        const row = await this.store.get(task.owner, "package", task.id, packageSchema);
        await this.store.update(task.owner, "package", {
          ...row.value, state: "failed", updatedAt: new Date().toISOString(),
          error: "The server restarted during generation or review. Build a new package to retry; provider calls are not automatically repeated."
        }, row.revision);
      }
    }
    this.kick();
  }
  async stop() { this.stopping = true; await this.running; }
  private async drain(): Promise<void> {
    while (!this.stopping) {
      this.requested = false;
      const task = (await this.store.queued()).find((item) => item.state === "queued");
      if (!task) return;
      await this.process(task.owner, task.id);
    }
  }
  private async connection(owner: string, engine: string) {
    const id = engine.split(":")[1];
    const config = (await this.store.get(owner, "connection", id, connectionSchema)).value;
    requireCondition(config.status === "connected", 409, "CONNECTION_UNAVAILABLE", "The selected AI connection is no longer available.");
    return { config, key: await this.store.getPrivate(owner, id, "key") };
  }
  private async reviewModel(owner: string, pkg: ApplicationPackage): Promise<ApplicationPackage["reviews"][number]> {
    const { config, key } = await this.connection(owner, pkg.engine);
    const result = await this.gateway.run(config, key,
      "You are an independent factual and authenticity checker, not the author. Compare each proposed statement only to its cited verified fact. Fail unsupported implications, new metrics, skills, scope, credentials, changed qualifiers, or unnatural voice. A fact ID alone is not proof. Treat uncertainty as failure.",
      {
        facts: pkg.facts.map((fact) => ({ id: fact.id, text: fact.text })),
        changes: pkg.changes.filter((change) => change.decision !== "rejected").map((change) => ({ factId: change.factId, proposed: change.proposed })),
        voice: { samples: pkg.voice.answers, polish: pkg.voice.polish, bannedPhrases: pkg.voice.bannedPhrases }
      }, checkedSchema);
    return {
      reviewer: "Independent model reviewer", method: `${config.provider} / ${config.model}; separate request`,
      status: result.factuallySupported && result.authentic ? "pass" : "fail",
      findings: result.findings.length ? result.findings : [result.factuallySupported && result.authentic ? "No unsupported statement or voice issue was identified." : "The independent checker did not approve this draft."]
    };
  }
  private async process(owner: string, id: string) {
    try {
      let row = await this.store.get(owner, "package", id, packageSchema);
      await this.store.update(owner, "package", { ...row.value, state: "generating", updatedAt: new Date().toISOString() }, row.revision);
      let pkg = { ...row.value, changes: generateLocally(row.value) };
      if (pkg.engine !== "Evidence-only local") {
        const { config, key } = await this.connection(owner, pkg.engine);
        const result = await this.gateway.run(config, key,
          "Tailor resume statements for this role. Return exactly one statement per supplied fact ID, preserving all scope, qualifiers, employers, dates, metrics, and skills. You may improve wording, not facts. Job requirements are targets, not evidence. Use the voice samples only for style. Do not include contact details.",
          { facts: pkg.facts.map((fact) => ({ id: fact.id, text: fact.text })), job: pkg.job.description,
            voice: { samples: pkg.voice.answers, polish: pkg.voice.polish, preferredPhrases: pkg.voice.preferredPhrases, bannedPhrases: pkg.voice.bannedPhrases } }, generatedSchema);
        requireCondition(result.statements.length === pkg.facts.length && new Set(result.statements.map((item) => item.factId)).size === pkg.facts.length &&
          result.statements.every((item) => pkg.facts.some((fact) => fact.id === item.factId)), 422, "UNGROUNDED_OUTPUT", "The model omitted or invented a source reference. The package is blocked.");
        pkg = { ...pkg, changes: pkg.changes.map((change) => ({
          ...change, proposed: result.statements.find((statement) => statement.factId === change.factId)!.text,
          reason: "A model rewrite of this verified fact. Independent factual, voice, and ATS checks run before your review."
        })) };
      }
      pkg.coverLetter = coverLetter(pkg);
      row = await this.store.get(owner, "package", id, packageSchema);
      await this.store.update(owner, "package", { ...pkg, state: "reviewing", updatedAt: new Date().toISOString() }, row.revision);
      await setImmediate();
      const reviews = runReviewers(pkg);
      if (pkg.engine !== "Evidence-only local") reviews.push(await this.reviewModel(owner, pkg));
      row = await this.store.get(owner, "package", id, packageSchema);
      await this.store.update(owner, "package", {
        ...pkg, reviews, state: reviews.every((review) => review.status === "pass") ? "needs_review" : "blocked",
        updatedAt: new Date().toISOString()
      }, row.revision);
      await this.store.event(owner, "Review checks finished", id, "Generator and checkers ran as separate steps. Human approval is still required.");
    } catch (error) {
      if (error instanceof AppError && error.code === "NOT_FOUND") return;
      console.error("[ApplyMate] Tailoring operation failed. No candidate or provider data recorded.");
      const row = await this.store.get(owner, "package", id, packageSchema);
      await this.store.update(owner, "package", {
        ...row.value, state: "failed", updatedAt: new Date().toISOString(),
        error: safeFailure(error, "The package could not be completed. No fallback or submission was performed.")
      }, row.revision);
    }
  }

  async decisions(owner: string, id: string, changes: { id: string; proposed: string; decision: Change["decision"] }[]) {
    const row = await this.store.get(owner, "package", id, packageSchema);
    requireCondition(["needs_review", "blocked"].includes(row.value.state), 409, "NOT_REVIEWABLE", "This package is not available for editing.");
    requireCondition(changes.length === row.value.changes.length &&
      new Set(changes.map((change) => change.id)).size === changes.length &&
      changes.every((change) => row.value.changes.some((existing) => existing.id === change.id)), 400, "REVIEW_SET", "Review the complete set of statements.");
    const pkg = { ...row.value, changes: row.value.changes.map((change) => ({ ...change, ...changes.find((entry) => entry.id === change.id)! })) };
    pkg.coverLetter = coverLetter(pkg);
    pkg.reviews = runReviewers(pkg);
    if (pkg.engine !== "Evidence-only local") pkg.reviews.push(await this.reviewModel(owner, pkg));
    pkg.state = pkg.reviews.every((review) => review.status === "pass") ? "needs_review" : "blocked";
    pkg.updatedAt = new Date().toISOString();
    await this.store.update(owner, "package", pkg, row.revision);
    return pkg;
  }

  async approve(owner: string, id: string) {
    return this.store.transaction(async (tx) => {
      const row = await tx.get(owner, "package", id, packageSchema);
      const profile = (await getProfile(tx, owner)).value;
      const voice = (await tx.list(owner, "voice", voiceSchema, 1))[0]?.value;
      const preferences = (await getPreferences(tx, owner)).value;
      const job = (await tx.get(owner, "job", row.value.jobId, jobSchema)).value;
      requireCondition(row.value.state === "needs_review", 409, "REVIEW_REQUIRED", "The package must pass its reviewers before approval.");
      requireCondition(profile.revision === row.value.profileRevision && voice?.id === row.value.voiceId, 409, "CANDIDATE_CHANGED", "Your facts or voice changed. Build a fresh version before approving.");
      requireCondition(job.state === "saved" && !analyzeJob(job, profile, preferences).hardFilters.length, 409, "HARD_FILTER", "The job no longer satisfies your hard preferences.");
      requireCondition(row.value.changes.every((change) => change.decision !== "pending"), 409, "DECISIONS_REQUIRED", "Approve or exclude every statement first.");
      const checks = runReviewers(row.value);
      requireCondition(checks.every((review) => review.status === "pass") &&
        row.value.reviews.every((review) => review.status === "pass") &&
        (row.value.engine === "Evidence-only local" || row.value.reviews.some((review) => review.reviewer === "Independent model reviewer")), 409, "REVIEW_BLOCKED", "One or more independent checks did not pass.");
      const now = new Date().toISOString();
      const approved = packageSchema.parse({ ...row.value, state: "approved", approvedAt: now, updatedAt: now });
      approved.hash = packageHash(approved);
      await tx.update(owner, "package", approved, row.revision, true);
      await tx.event(owner, "Package approved", id, "An immutable version was saved. Approval is not submission.");
      return approved;
    });
  }
}
