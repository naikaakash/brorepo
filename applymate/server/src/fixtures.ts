import { fieldNames, jobSchema, packageSchema, voicePrompts } from "@applymate/contracts";
import type { ApplicationPackage } from "@applymate/contracts";
import { buildVoice, extractCandidate, initialPreferences, initialProfile } from "./candidate.js";
import { analyzeJob } from "./jobs.js";
import { runReviewers } from "./reviews.js";
import { metadata } from "./store.js";
import { coverLetter, generateLocally, packageHash } from "./tailoring.js";

export const sampleResume = `Taylor Reed
Software Engineer
taylor@example.test
Seattle, WA
Summary
Software engineer building accessible web tools.
Skills
TypeScript, React, Node.js, PostgreSQL, SQL, HTML, CSS
Experience
Software Engineer | Example Studio | 2021 - 2025
Built React interfaces with TypeScript and accessible HTML.
Reduced page loading time by 20% by optimizing SQL queries.
Education
BSc in Computer Science | Example University | 2021`;

export const sampleJob = {
  title: "Software Engineer", company: "Example Company", location: "Seattle, WA",
  workStyle: "remote" as const, salaryMinimum: null, salaryMaximum: null, currency: "USD" as const,
  sourceUrl: "https://example.test/careers/engineer",
  description: "Build accessible applications with React and TypeScript.\nExperience with SQL and PostgreSQL.\nWork with the team to deliver reliable tools.\nTesting and communication are preferred."
};
export const writingSample = "I like making complicated things easier for people to use. I start by listening to the problem, then try a small solution and ask for feedback. Clear explanations matter to me. I prefer practical examples over big promises.";

export const sampleVoice = {
  answers: voicePrompts.slice(0, 3).map((prompt) => ({ promptId: prompt.id, text: writingSample })),
  polish: "Preserve My Style" as const, preferredPhrases: [], bannedPhrases: ["synergy"]
};

export function fixturePackage(resume = sampleResume): ApplicationPackage {
  const documentId = metadata().id;
  const profile = initialProfile("taylor@example.test");
  const extracted = extractCandidate(resume, documentId);
  for (const key of fieldNames) {
    profile.fields[key] = { ...extracted.proposedFields[key], state: extracted.proposedFields[key].value ? "verified" : "proposed" };
  }
  profile.facts = extracted.proposedFacts.map((fact) => ({ ...fact, state: "verified" }));
  profile.documentIds = [documentId];
  profile.revision = 3;
  const voice = buildVoice(sampleVoice, 1);
  const job = jobSchema.parse({
    ...metadata(), ...sampleJob, fingerprint: "fixture", state: "saved", declineReason: "",
    analysis: analyzeJob(sampleJob, profile, initialPreferences())
  });
  const pkg = packageSchema.parse({
    ...metadata(), jobId: job.id, sourceDocumentId: documentId, profileRevision: profile.revision,
    voiceId: voice.id, version: 1, state: "approved", engine: "Evidence-only local", error: "",
    candidate: Object.fromEntries(fieldNames.map((key) => [key, profile.fields[key].value])),
    facts: profile.facts, voice, job, changes: [], reviews: [], coverLetter: "",
    approvedAt: new Date().toISOString(), hash: ""
  });
  pkg.changes = generateLocally(pkg).map((change) => ({ ...change, decision: "approved" }));
  pkg.coverLetter = coverLetter(pkg);
  pkg.reviews = runReviewers(pkg);
  pkg.hash = packageHash(pkg);
  return pkg;
}
