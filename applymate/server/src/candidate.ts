import { Worker } from "node:worker_threads";
import { extname } from "node:path";
import {
  fieldNames, profileSchema, preferenceSchema, voiceSchema, voicePrompts,
  documentSchema, limits, z
} from "@applymate/contracts";
import type {
  Profile, ProfileField, CandidateFact, DocumentRecord, Voice,
  profileUpdateSchema, voiceUpdateSchema, Preferences
} from "@applymate/contracts";
import { digest } from "./crypto.js";
import { AppError, requireCondition } from "./errors.js";
import { metadata } from "./store.js";
import type { Store } from "./store.js";

export const emptyField = (): ProfileField => ({
  value: "", state: "proposed", source: { kind: "manual", confidence: 0, excerpt: "" }
});
export function initialProfile(email: string): Profile {
  return profileSchema.parse({
    ...metadata(), revision: 0, documentIds: [], facts: [], onboardingStep: "upload",
    fields: {
      fullName: emptyField(), email: { value: email, state: "proposed", source: { kind: "account", confidence: 1, excerpt: "Sign-in email; confirm your preferred contact address." } },
      phone: emptyField(), location: emptyField(), headline: emptyField(), website: emptyField()
    }
  });
}
export function initialPreferences(): Preferences {
  return preferenceSchema.parse({
    ...metadata(), roles: [], locations: [], workStyle: "any", salaryMinimum: null,
    currency: "USD", excludedCompanies: [], mode: "Review", hybridThreshold: 80, dailyLimit: 5, notifications: true
  });
}
export async function ensureCandidate(store: Store, owner: string, email: string) {
  return store.transaction(async (tx) => {
    if ((await tx.list(owner, "profile", profileSchema, 1)).length === 0) {
      await tx.create(owner, "profile", initialProfile(email));
      await tx.create(owner, "preferences", initialPreferences());
      await tx.event(owner, "Account created", owner, "Local data notice acknowledged. Resume-first onboarding is ready.");
    }
  });
}
export async function getProfile(store: Store, owner: string) {
  const rows = await store.list(owner, "profile", profileSchema, 1);
  requireCondition(rows[0], 409, "PROFILE_NOT_READY", "Open your workspace to initialize your profile.");
  return rows[0];
}
export async function getPreferences(store: Store, owner: string) {
  const rows = await store.list(owner, "preferences", preferenceSchema, 1);
  requireCondition(rows[0], 409, "PREFERENCES_NOT_READY", "Open your workspace first.");
  return rows[0];
}

export function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function extractCandidate(raw: string, documentId: string): Pick<DocumentRecord, "proposedFields" | "proposedFacts"> {
  const lines = raw.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter((line) => line && !/^--?\s*\d+\s*(of|\/)\s*\d+\s*--?$/i.test(line));
  const fields = initialProfile("").fields;
  const set = (name: keyof Profile["fields"], value: string, confidence: number, excerpt = value) => {
    fields[name] = { value: value.slice(0, 500), state: "proposed", source: { kind: "resume", documentId, confidence, excerpt: excerpt.slice(0, 2000) } };
  };
  const heading = (line: string) => /^(professional\s+)?(experience|employment|work history|education|skills|technical skills|certifications?|projects?|achievements?|summary|profile|objective|volunteer experience)\s*:?\s*$/i.test(line);
  const name = lines.slice(0, 4).find((line) => /^[\p{L}][\p{L}\p{M} .'-]{2,70}$/u.test(line) &&
    line.split(/\s+/).length <= 6 && !heading(line) && !/\b(resume|curriculum vitae|engineer|developer|manager|analyst|consultant)\b/i.test(line));
  if (name) set("fullName", name, 0.75);
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) set("email", email, 0.98);
  const phone = lines.slice(0, 12).flatMap((line) => line.match(/\+?\d[\d ().-]{8,24}\d/g) ?? [])
    .find((value) => value.replace(/\D/g, "").length >= 10 && value.replace(/\D/g, "").length <= 15);
  if (phone) set("phone", phone, 0.8);
  const website = raw.match(/(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/|github\.com\/)[a-zA-Z0-9_./-]+/i)?.[0];
  if (website) set("website", /^https?:\/\//i.test(website) ? website : `https://${website}`, 0.85, website);
  const location = lines.slice(0, 10).find((line) => /^(location|based in|address)\s*:/i.test(line))?.replace(/^[^:]+:\s*/, "") ??
    lines.slice(0, 6).find((line) => /^[\p{L} .'-]+,\s*[\p{L} .'-]+$/u.test(line));
  if (location) set("location", location, 0.6);
  const headline = lines.slice(0, 6).find((line) => line.length < 100 &&
    /\b(engineer|developer|manager|analyst|specialist|designer|nurse|consultant|researcher|director|scientist|coordinator)\b/i.test(line) &&
    !line.includes("@") && !/\d{4}/.test(line));
  if (headline) set("headline", headline, 0.6);

  let category: CandidateFact["category"] = "summary";
  const facts: CandidateFact[] = [];
  const fieldLines = new Set(Object.values(fields).map((field) => normalize(field.value)).filter(Boolean));
  for (const line of lines) {
    if (heading(line)) {
      const lower = line.toLowerCase();
      category = /education/.test(lower) ? "education" : /skills/.test(lower) ? "skill" :
        /certif/.test(lower) ? "certification" : /project/.test(lower) ? "project" :
          /achievement/.test(lower) ? "achievement" : /experience|employment|history/.test(lower) ? "experience" : "summary";
      continue;
    }
    if (fieldLines.has(normalize(line)) || /@|linkedin\.com\/in\/|github\.com\//i.test(line) || /^https?:\/\//i.test(line)) continue;
    const value = line.replace(/^[\u2022\u25cf\u25aa*-]\s*/, "").trim();
    if (value.length < 4 || /^(resume|curriculum vitae)$/i.test(value)) continue;
    requireCondition(value.length <= 2000 && facts.length < 250, 422, "RESUME_COMPLEX", "This resume has too much unstructured content. Simplify long paragraphs and try again.");
    facts.push({
      ...metadata(), category, text: value, state: "proposed",
      source: { kind: "resume", documentId, confidence: category === "summary" ? 0.55 : 0.8, excerpt: value }
    });
  }
  requireCondition(facts.length, 422, "NO_CAREER_FACTS", "Contact details were found, but no career evidence. Include your experience, skills, or education.");
  return { proposedFields: fields, proposedFacts: facts };
}

const extractionSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), text: z.string().max(100000), warnings: z.array(z.string().max(500)) }),
  z.object({ ok: z.literal(false), message: z.string().max(1000) })
]);

export async function parseResume(file: { originalname: string; buffer: Buffer }): Promise<DocumentRecord> {
  requireCondition(file.buffer.length && file.buffer.length <= limits.uploadBytes, 413, "UPLOAD_LIMIT", "Choose a non-empty file under 5 MB.");
  const extension = extname(file.originalname).toLowerCase();
  const kind = extension === ".pdf" ? "pdf" : extension === ".docx" ? "docx" : extension === ".txt" ? "txt" : null;
  requireCondition(kind, 415, "UNSUPPORTED_FILE", "Upload a PDF, DOCX, or UTF-8 TXT resume.");
  requireCondition(kind !== "pdf" || file.buffer.subarray(0, 5).toString() === "%PDF-", 415, "FILE_SIGNATURE", "The file is not a valid PDF.");
  requireCondition(kind !== "docx" || file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 415, "FILE_SIGNATURE", "The file is not a valid DOCX.");
  const parsed = await new Promise<z.infer<typeof extractionSchema>>((resolve, reject) => {
    const worker = new Worker(new URL("./resume-worker.mjs", import.meta.url), {
      workerData: { kind, bytes: file.buffer }, resourceLimits: { maxOldGenerationSizeMb: 192 }
    });
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new AppError(422, "PARSING_TIMEOUT", "The resume took too long to read. Try a simpler text-based PDF or DOCX."));
    }, 15000);
    worker.once("message", (message: unknown) => {
      clearTimeout(timeout);
      void worker.terminate();
      const result = extractionSchema.safeParse(message);
      if (result.success) resolve(result.data);
      else reject(new AppError(422, "PARSE_FAILED", "The document parser returned an invalid result."));
    });
    worker.once("error", () => {
      clearTimeout(timeout);
      reject(new AppError(422, "PARSE_FAILED", "The resume could not be read. Try an unencrypted, text-based document."));
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new AppError(422, "PARSE_FAILED", "Document parsing stopped. Try a smaller or simpler resume."));
      }
    });
  });
  if (!parsed.ok) throw new AppError(422, "UNREADABLE_RESUME", parsed.message);
  const meta = metadata();
  const extracted = extractCandidate(parsed.text, meta.id);
  return documentSchema.parse({
    ...meta, name: file.originalname.replace(/[\\/\p{Cc}]/gu, "_").slice(0, 200),
    mime: kind === "pdf" ? "application/pdf" : kind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain",
    size: file.buffer.length, text: parsed.text, sha256: digest(file.buffer), imported: false,
    warnings: ["Extraction is rule-based. All proposed fields and career facts need your confirmation.", ...parsed.warnings],
    ...extracted
  });
}

export async function saveResume(store: Store, owner: string, document: DocumentRecord, bytes: Buffer) {
  return store.transaction(async (tx) => {
    const existing = await tx.list(owner, "document", documentSchema);
    requireCondition(existing.length < limits.documents, 409, "DOCUMENT_LIMIT", "The local limit is 30 uploaded resumes.");
    requireCondition(!existing.some((row) => row.value.sha256 === document.sha256), 409, "DUPLICATE_RESUME", "You already uploaded this exact document.");
    const current = await getProfile(tx, owner);
    const first = current.value.documentIds.length === 0;
    const saved = { ...document, imported: first };
    await tx.create(owner, "document", saved, !first);
    await tx.putPrivate(owner, document.id, "binary", bytes.toString("base64"));
    if (first) {
      const fields = { ...current.value.fields };
      for (const key of fieldNames) if (document.proposedFields[key].value) fields[key] = document.proposedFields[key];
      await tx.update(owner, "profile", {
        ...current.value, fields, facts: document.proposedFacts, documentIds: [document.id],
        revision: current.value.revision + 1, onboardingStep: "review", updatedAt: new Date().toISOString()
      }, current.revision);
    }
    await tx.event(owner, "Resume parsed", document.id, first ? "Proposed facts are ready for your review." : "Merge preview ready. Verified facts have not been changed.");
    return { document: saved, mergeRequired: !first };
  });
}

export const mergeSchema = z.object({
  revision: z.number().int(), fields: z.array(z.enum(fieldNames)).max(6), factIds: z.array(z.string().uuid()).max(250)
}).strict();

export async function mergeResume(store: Store, owner: string, id: string, input: z.infer<typeof mergeSchema>) {
  await store.transaction(async (tx) => {
    const doc = await tx.get(owner, "document", id, documentSchema);
    const current = await getProfile(tx, owner);
    requireCondition(current.value.revision === input.revision, 409, "PROFILE_CHANGED", "Your profile changed. Reopen the merge preview.");
    requireCondition(!current.value.documentIds.includes(id), 409, "ALREADY_MERGED", "This resume was already added to your profile.");
    const fields = { ...current.value.fields };
    for (const field of input.fields) fields[field] = doc.value.proposedFields[field];
    const selected = new Set(input.factIds);
    requireCondition(input.factIds.every((factId) => doc.value.proposedFacts.some((fact) => fact.id === factId)), 400, "INVALID_FACT", "Choose facts from this merge preview.");
    const existing = new Set(current.value.facts.map((fact) => normalize(fact.text)));
    const newFacts = doc.value.proposedFacts.filter((fact) => selected.has(fact.id) && !existing.has(normalize(fact.text)));
    requireCondition(current.value.facts.length + newFacts.length <= 250, 409, "FACT_LIMIT", "The merged profile exceeds 250 facts. Select fewer facts.");
    await tx.update(owner, "profile", {
      ...current.value, fields, facts: [...current.value.facts, ...newFacts],
      revision: current.value.revision + 1, documentIds: [...current.value.documentIds, id],
      updatedAt: new Date().toISOString()
    }, current.revision);
    await tx.event(owner, "Resume merged", id, "Only explicitly selected fields and new facts were added as proposed.");
  });
}

export async function updateProfile(store: Store, owner: string, input: z.infer<typeof profileUpdateSchema>) {
  await store.transaction(async (tx) => {
    const current = await getProfile(tx, owner);
    requireCondition(input.revision === current.value.revision, 409, "PROFILE_CHANGED", "Your profile changed. Refresh and review your edits.");
    requireCondition(new Set(input.facts.map((fact) => fact.id)).size === input.facts.length, 400, "DUPLICATE_FACT", "Each fact must have a unique identifier.");
    if (input.confirm) {
      requireCondition(input.fields.fullName.length >= 2 && z.email().safeParse(input.fields.email).success, 400, "CONTACT_REQUIRED", "Confirm your name and a valid contact email.");
      requireCondition(input.facts.some((fact) => fact.state === "verified"), 400, "FACTS_REQUIRED", "Confirm at least one career fact before continuing.");
    }
    if (input.fields.email) requireCondition(z.email().safeParse(input.fields.email).success, 400, "INVALID_EMAIL", "Enter a valid contact email.");
    const now = new Date().toISOString();
    const fields = { ...current.value.fields };
    for (const key of fieldNames) {
      const value = input.fields[key];
      const previous = current.value.fields[key];
      fields[key] = {
        value, state: input.confirm && value ? "verified" : previous.value === value ? previous.state : "proposed",
        source: previous.value === value ? previous.source : { kind: "manual", confidence: 1, excerpt: value }
      };
    }
    const facts = input.facts.map((incoming): CandidateFact => {
      const old = current.value.facts.find((fact) => fact.id === incoming.id);
      return {
        ...(old ?? metadata()), ...incoming, updatedAt: now,
        source: old && old.text === incoming.text ? old.source : {
          kind: "manual", confidence: 1, excerpt: old?.source.excerpt ?? incoming.text,
          ...(old?.source.documentId ? { documentId: old.source.documentId } : {})
        }
      };
    });
    const nextStep = input.confirm && ["upload", "review", "gaps"].includes(current.value.onboardingStep) ?
      (await tx.list(owner, "voice", voiceSchema, 1))[0]?.value.complete ? "preferences" : "voice" : current.value.onboardingStep;
    await tx.update(owner, "profile", {
      ...current.value, fields, facts, revision: current.value.revision + 1, updatedAt: now,
      onboardingStep: nextStep
    }, current.revision);
    await tx.event(owner, "Candidate facts updated", current.value.id, "Changes apply to future packages; approved versions remain unchanged.");
  });
}

export function buildVoice(input: z.infer<typeof voiceUpdateSchema>, version: number): Voice {
  requireCondition(new Set(input.answers.map((answer) => answer.promptId)).size === input.answers.length &&
    input.answers.every((answer) => voicePrompts.some((prompt) => prompt.id === answer.promptId)), 400, "INVALID_PROMPT", "Use each of the provided interview prompts at most once.");
  const corpus = input.answers.map((answer) => answer.text).join("\n");
  const words = corpus.match(/\p{L}+(?:['\u2019]\p{L}+)?/gu) ?? [];
  const sentences = corpus.split(/[.!?]+/).filter((sentence) => sentence.trim().length);
  const average = Math.round(words.length / Math.max(1, sentences.length));
  return voiceSchema.parse({
    ...metadata(), ...input, version,
    attributes: {
      averageSentenceWords: average, wordCount: words.length,
      contractions: /\b\w+['\u2019](?:t|m|ve|re|ll|d|s)\b/i.test(corpus),
      directness: average <= 18 ? "Short, direct sentences" : "Detailed, explanatory sentences",
      formality: /\b(?:I'm|I'd|don't|that's|we're)\b/i.test(corpus) ? "Conversational" : "Measured"
    },
    complete: input.answers.filter((answer) => answer.text.trim().length >= 20).length >= 3 && words.length >= 80
  });
}

export async function saveVoice(store: Store, owner: string, input: z.infer<typeof voiceUpdateSchema>) {
  return store.transaction(async (tx) => {
    requireCondition(await tx.count(owner, "voice") < 200, 409, "VOICE_LIMIT", "The local workspace supports up to 200 saved voice versions.");
    const versions = await tx.list(owner, "voice", voiceSchema, 1);
    const voice = buildVoice(input, (versions[0]?.value.version ?? 0) + 1);
    await tx.create(owner, "voice", voice, true);
    const profile = await getProfile(tx, owner);
    if (voice.complete && profile.value.onboardingStep === "voice") {
      await tx.update(owner, "profile", {
        ...profile.value, revision: profile.value.revision + 1, onboardingStep: "preferences", updatedAt: new Date().toISOString()
      }, profile.revision);
    }
    await tx.event(owner, "Voice saved", voice.id, `Version ${voice.version}: ${voice.complete ? "ready for tailoring" : "more writing samples needed"}. Interview answers are never treated as career evidence.`);
    return voice;
  });
}
