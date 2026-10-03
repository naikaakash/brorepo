import { jobSchema } from "@applymate/contracts";
import type { Job, Profile, Preferences, jobInputSchema, z } from "@applymate/contracts";
import { digest } from "./crypto.js";
import { normalize } from "./candidate.js";
import { metadata } from "./store.js";
import { requireCondition } from "./errors.js";
import type { Store } from "./store.js";

const stop = new Set("a an and are as at be been being by can candidate candidates company demonstrate demonstrated excellent experience for from good has have in including is it job knowledge must of on or our preferred qualification qualifications related required requirements responsibilities role skills strong successful team the their this to using we will with work working you your years year ability able".split(" "));
const knownSkills = [
  "React", "TypeScript", "JavaScript", "Node.js", "Python", "SQL", "PostgreSQL", "Java", "C++", "C#",
  ".NET", "Go", "Rust", "Azure", "AWS", "GCP", "Docker", "Kubernetes", "Git", "HTML", "CSS",
  "GraphQL", "REST", "Power BI", "Tableau", "Excel", "Figma", "Salesforce", "SAP",
  "data analysis", "project management", "product management", "user research", "clinical informatics",
  "health informatics", "patient care", "nursing", "marketing", "sales", "research", "leadership",
  "communication", "accessibility", "WCAG", "testing", "Agile", "Scrum", "machine learning"
];
export function words(value: string): string[] {
  return [...new Set(normalize(value).split(" ").filter((word) => word.length > 2 && !stop.has(word)))];
}
export function keywords(value: string): string[] {
  const normalized = ` ${normalize(value)} `;
  return knownSkills.filter((skill) => normalized.includes(` ${normalize(skill)} `));
}
function positiveFacts(profile: Profile) {
  return profile.facts.filter((fact) => fact.state === "verified" && !/\b(no|not|never|without|lack|lacking|unfamiliar)\b/i.test(fact.text));
}
export function analyzeJob(job: Pick<Job, "description" | "title" | "company" | "location" | "workStyle" | "salaryMaximum" | "currency">, profile: Profile, preferences: Preferences): Job["analysis"] {
  const hardFilters: string[] = [];
  if (preferences.excludedCompanies.some((company) => normalize(company) === normalize(job.company))) hardFilters.push("This company is on your exclusion list.");
  if (preferences.workStyle !== "any" && preferences.workStyle !== job.workStyle) hardFilters.push(job.workStyle === "unknown" ? "Your required work arrangement is not confirmed." : `This role does not match your ${preferences.workStyle} preference.`);
  if (preferences.locations.length && job.workStyle !== "remote" &&
    !preferences.locations.some((location) => normalize(job.location).includes(normalize(location)))) hardFilters.push("The job location does not match your selected locations.");
  if (preferences.roles.length && !preferences.roles.some((role) => normalize(job.title).includes(normalize(role)))) hardFilters.push("The title does not match your selected target roles.");
  if (preferences.salaryMinimum !== null) {
    if (job.salaryMaximum === null || job.currency !== preferences.currency) hardFilters.push("Your salary floor cannot be verified from the provided range and currency.");
    else if (job.salaryMaximum < preferences.salaryMinimum) hardFilters.push("The advertised salary maximum is below your floor.");
  }
  const statements = job.description.split(/\n+|(?<=[.!?;])\s+/).map((line) => line.replace(/^[*\-\u2022]\s*/, "").trim())
    .filter((line) => line.length >= 15 && !/^(about (the|us)|benefits|equal opportunity|we (are|offer))\b/i.test(line));
  const candidates = positiveFacts(profile);
  const requirements: Job["analysis"]["requirements"] = statements.slice(0, 40).map((statement) => {
    const skillTerms = keywords(statement);
    const skillWords = new Set(skillTerms.flatMap((skill) => normalize(skill).split(" ")));
    const terms = [...skillTerms.map(normalize), ...words(statement).filter((word) => !skillWords.has(word))];
    const numbers = statement.match(/\b\d+(?:\.\d+)?\+?\b/g) ?? [];
    const matches = candidates.map((fact) => {
      const normalized = ` ${normalize(fact.text)} `;
      const matched = terms.filter((term) => normalized.includes(` ${term} `));
      return { fact, matched, coverage: matched.length / Math.max(1, terms.length) };
    }).filter((match) => match.matched.length).sort((a, b) => b.coverage - a.coverage).slice(0, 4);
    const union = new Set(matches.flatMap((match) => match.matched));
    const covered = terms.length > 0 && union.size === terms.length;
    const numericEvidence = numbers.every((number) => matches.some((match) =>
      (match.fact.text.match(/\b\d+(?:\.\d+)?\+?\b/g) ?? []).some((token) => token === number)));
    // Keyword overlap alone cannot prove qualifiers such as tenure, fluency, or management scope.
    const hasUnverifiedQualifier = /\b(years?|fluency|fluent|native|expert|advanced|senior|lead|manage|bachelor|master|phd|clearance|citizen|authorized)\b/i.test(statement) &&
      !matches.some((match) => normalize(match.fact.text).includes(normalize(statement.replace(/^(?:must have|required:?)\s*/i, ""))));
    const supported = covered && numericEvidence && !hasUnverifiedQualifier;
    const status = !terms.length ? "unknown" : supported ? "supported" : matches.length ? "partial" : "missing";
    return {
      id: metadata().id, text: statement.slice(0, 1500),
      priority: /\b(preferred|bonus|nice to have|ideally)\b/i.test(statement) ? "preferred" : "required",
      status, factIds: matches.map((match) => match.fact.id), keywords: skillTerms,
      rationale: status === "supported" ? "These exact terms appear in your verified evidence. This is lexical support, not a semantic qualification guarantee." :
        status === "partial" ? "Some terms match verified evidence, but the complete requirement or its qualifiers are unconfirmed." :
          status === "missing" ? "No verified fact supports these terms. Nothing will be invented to fill this gap." :
            "There is not enough structured information to evaluate this requirement."
    };
  });
  return {
    method: "Evidence-based lexical analysis", profileRevision: profile.revision,
    score: requirements.length ? Math.round(100 * requirements.filter((item) => item.status === "supported").length / requirements.length) : 0,
    hardFilters, requirements
  };
}
export function canonicalUrl(value: string): string {
  if (!value) return "";
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(ref|referrer|trackingId)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export async function importJob(store: Store, owner: string, input: z.infer<typeof jobInputSchema>, profile: Profile, preferences: Preferences) {
  const fingerprint = digest(normalize(`${input.company} ${input.title} ${input.location} ${input.description}`));
  return store.transaction(async (tx) => {
    const jobs = await tx.list(owner, "job", jobSchema);
    requireCondition(jobs.length < 200, 409, "JOB_LIMIT", "The local workspace supports up to 200 saved jobs.");
    requireCondition(!jobs.some(({ value }) => value.fingerprint === fingerprint ||
      (input.sourceUrl && canonicalUrl(value.sourceUrl) === canonicalUrl(input.sourceUrl))), 409, "DUPLICATE_JOB", "This job is already in your workspace.");
    const job = jobSchema.parse({
      ...metadata(), ...input, fingerprint, state: "saved", declineReason: "",
      analysis: analyzeJob(input, profile, preferences)
    });
    await tx.create(owner, "job", job);
    await tx.event(owner, "Job imported", job.id, "Hard preferences checked before evidence coverage. No employer was contacted.");
    return job;
  });
}
