import { fieldNames, limits, voicePrompts, voiceSchema, workspaceSchema } from "@applymate/contracts";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const metadata = () => ({ id: crypto.randomUUID(), createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" });
const writing = "I enjoy making useful things that are easy to understand. I listen to the people who will use them and try a small version first. I explain the choices in plain language, then use feedback to make the next version better.";

export function voiceFixture() {
  return voiceSchema.parse({
    ...metadata(), version: 1, complete: true,
    answers: voicePrompts.slice(0, 3).map((prompt) => ({ promptId: prompt.id, text: writing })),
    polish: "Preserve My Style", preferredPhrases: [], bannedPhrases: [],
    attributes: { averageSentenceWords: 14, wordCount: 129, contractions: false, directness: "Short, direct sentences", formality: "Measured" }
  });
}

export function workspaceFixture(ready = false) {
  const source = { kind: "manual", excerpt: "", confidence: 1 };
  const document = { ...metadata(), name: "synthetic-resume.txt", mime: "text/plain", size: 150, sha256: "0".repeat(64), imported: true, warnings: [] };
  const fields = Object.fromEntries(fieldNames.map((key) => [key, { value: "", state: "proposed", source }]));
  fields.fullName = { value: ready ? "Taylor Reed" : "", state: ready ? "verified" : "proposed", source };
  fields.email = { value: "learner@example.test", state: "verified", source };
  return workspaceSchema.parse({
    user: { id: crypto.randomUUID(), email: "learner@example.test", name: "Learner" },
    profile: { ...metadata(), revision: 0, fields, documentIds: ready ? [document.id] : [], onboardingStep: ready ? "complete" : "upload",
      facts: ready ? [{ ...metadata(), category: "skill", text: "TypeScript and React", state: "verified", source }] : [] },
    preferences: { ...metadata(), roles: [], locations: [], workStyle: "any", salaryMinimum: null, currency: "USD",
      excludedCompanies: [], mode: "Review", hybridThreshold: 85, dailyLimit: 5, notifications: false },
    voice: ready ? voiceFixture() : null, documents: ready ? [document] : [],
    jobs: [], packages: [], applications: [], answers: [], connections: [], activity: [],
    capabilities: { localOnly: true, mailMode: "local", engine: "Evidence-only local", automation: false, managedInbox: false, billing: false,
      limits: { documents: limits.documents, jobs: limits.jobs, dailyPackages: limits.dailyPackages } }
  });
}
