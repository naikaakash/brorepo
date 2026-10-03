import type { ApplicationPackage, Review } from "@applymate/contracts";
import { keywords } from "./jobs.js";
import { normalize } from "./candidate.js";

function review(reviewer: Review["reviewer"], method: string, errors: string[], notes: string[] = []): Review {
  return { reviewer, method, status: errors.length ? "fail" : "pass", findings: errors.length ? errors : notes };
}
export function runReviewers(pkg: ApplicationPackage): Review[] {
  const selected = pkg.changes.filter((change) => change.decision !== "rejected");
  const factual: string[] = [];
  if (!selected.length) factual.push("Keep at least one verified statement in the resume.");
  if (new Set(pkg.changes.map((change) => change.factId)).size !== pkg.changes.length) factual.push("A source fact was duplicated.");
  for (const change of selected) {
    const fact = pkg.facts.find((candidate) => candidate.id === change.factId);
    if (!fact || fact.state !== "verified" || fact.text !== change.original || fact.category !== change.section) {
      factual.push("A statement does not match its verified source fact.");
      continue;
    }
    if (pkg.engine === "Evidence-only local" && normalize(change.proposed) !== normalize(fact.text)) {
      factual.push("Local mode preserves verified wording. To change a claim, update and confirm it in your profile, then rebuild.");
    }
    const oldNumbers: string[] = fact.text.match(/\d+(?:[.,]\d+)*(?:%|\+)?/g) ?? [];
    const newNumbers = change.proposed.match(/\d+(?:[.,]\d+)*(?:%|\+)?/g) ?? [];
    if (newNumbers.some((number) => !oldNumbers.includes(number))) factual.push("A proposed date, number, or metric is not present in its source.");
    const added = keywords(change.proposed).filter((skill) => !keywords(fact.text).includes(skill));
    if (added.length) factual.push(`Unverified skill terms were introduced: ${added.join(", ")}.`);
    if (/\b(no|not|never|without|lack|lacking)\b/i.test(fact.text) && normalize(change.proposed) !== normalize(fact.text)) factual.push("A negative or qualified statement was rewritten. Keep the original wording.");
    for (const claim of ["led", "managed", "owned", "expert", "certified", "fluent", "native", "architected", "directed", "awarded"]) {
      if (new RegExp(`\\b${claim}\\b`, "i").test(change.proposed) && !new RegExp(`\\b${claim}\\b`, "i").test(fact.text)) factual.push(`The stronger claim "${claim}" is not in the supporting fact.`);
    }
  }
  const content = selected.map((change) => change.proposed).join("\n");
  const voiceErrors = pkg.voice.bannedPhrases.filter((phrase) => phrase &&
    normalize(`${content}\n${pkg.coverLetter}`).includes(normalize(phrase))).map((phrase) => `Contains a phrase you do not want to use: "${phrase}".`);
  const sentences = content.split(/[.!?]+/).filter((value) => value.trim());
  const average = content.split(/\s+/).filter(Boolean).length / Math.max(1, sentences.length);
  const notes = [`Voice v${pkg.voice.version}; ${pkg.voice.polish}. Banned phrases checked. Writing statistics are indicative, not an AI-detector claim.`];
  if (pkg.engine !== "Evidence-only local" && average > Math.max(45, pkg.voice.attributes.averageSentenceWords * 3)) {
    voiceErrors.push("The proposed sentences are much longer than your writing samples. Shorten them or preserve the original.");
  }
  const atsErrors: string[] = [];
  if (content.length > 40000) atsErrors.push("The resume is too long for the local single-column exporter. Keep fewer statements.");
  if (/\p{Cc}/u.test(content.replace(/[\t\n\r]/g, ""))) atsErrors.push("Remove unsupported control characters before export.");
  if (!pkg.candidate.fullName || !pkg.candidate.email) atsErrors.push("A verified name and contact email are required.");
  const supportedKeywords = [...new Set(pkg.job.analysis.requirements.flatMap((requirement) => requirement.keywords))]
    .filter((keyword) => normalize(content).includes(normalize(keyword)));
  return [
    review("Factual integrity", "Deterministic source, qualification, metric, and skill checks", [...new Set(factual)], ["Every included statement points to a verified fact."]),
    review("Your voice", "Independent phrase and writing-statistics checks", voiceErrors, notes),
    review("ATS readability", "Independent text and single-column format checks", atsErrors,
      [supportedKeywords.length ? `Grounded job keywords: ${supportedKeywords.join(", ")}.` : "No exact job keyword overlap. No keywords were fabricated.", "PDF and DOCX use text, standard headings, and a single reading column. This is not a guarantee for every ATS."])
  ];
}
