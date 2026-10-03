import { describe, expect, it } from "vitest";
import { buildVoice, initialPreferences, initialProfile } from "./candidate.js";
import { analyzeJob, canonicalUrl } from "./jobs.js";
import { runReviewers } from "./reviews.js";
import { fixturePackage, sampleJob, sampleVoice } from "./fixtures.js";
import { metadata } from "./store.js";

function analyze(description: string) {
  const profile = initialProfile("taylor@example.test");
  profile.facts = fixturePackage().facts;
  return analyzeJob({ ...sampleJob, description }, profile, initialPreferences());
}

describe("candidate evidence rather than invented qualifications", () => {
  it("shows exact skill support but does not discard an unknown required skill", () => {
    expect(analyze("Experience with React and TypeScript.").requirements[0].status).toBe("supported");
    expect(analyze("Experience with React and Elixir.").requirements[0].status).toBe("partial");
    expect(analyze("Experience with Kubernetes and Go.").requirements[0].status).toBe("missing");
  });
  it("does not treat a date substring as numerical evidence or infer years of experience", () => {
    expect(analyze("Required SQL version 21.").requirements[0].status).not.toBe("supported");
    expect(analyze("Five years of expert React experience.").requirements[0].status).not.toBe("supported");
    expect(analyze("10 years of TypeScript experience.").requirements[0].status).not.toBe("supported");
  });
  it("ignores unconfirmed, excluded, and explicitly negative evidence", () => {
    const profile = initialProfile("test@example.test");
    profile.facts = fixturePackage().facts.map((fact) => ({ ...fact, state: "proposed" }));
    const job = { ...sampleJob, description: "Experience with React and TypeScript." };
    expect(analyzeJob(job, profile, initialPreferences()).score).toBe(0);
    profile.facts = profile.facts.map((fact) => ({ ...fact, state: "rejected" }));
    expect(analyzeJob(job, profile, initialPreferences()).score).toBe(0);
    profile.facts = [{
      ...metadata(), category: "skill", text: "No React or TypeScript experience.", state: "verified",
      source: { kind: "manual", confidence: 1, excerpt: "No React or TypeScript experience." }
    }];
    expect(analyzeJob(job, profile, initialPreferences()).score).toBe(0);
  });
  it("applies hard filters independently of lexical match coverage", () => {
    const profile = initialProfile("test@example.test");
    const preferences = { ...initialPreferences(), excludedCompanies: [sampleJob.company], roles: ["Designer"],
      workStyle: "onsite" as const, locations: ["Boston"], salaryMinimum: 100000 };
    const analysis = analyzeJob({ ...sampleJob, workStyle: "unknown" }, profile, preferences);
    expect(analysis.hardFilters).toHaveLength(5);
    expect(canonicalUrl("https://example.test/job?a=1&utm_source=test#apply")).toBe("https://example.test/job?a=1");
  });
});

describe("independent document review gates", () => {
  it("passes an unchanged grounded draft and rejects invented metrics, skills, and scope", () => {
    const pkg = fixturePackage();
    expect(runReviewers(pkg).every((review) => review.status === "pass")).toBe(true);
    pkg.engine = "openai:fixture:mock-model";
    const change = pkg.changes.find((item) => item.proposed.includes("20%"))!;
    change.proposed = "Led an expert Python team and reduced page loading time by 90%.";
    const factual = runReviewers(pkg).find((review) => review.reviewer === "Factual integrity")!;
    expect(factual.status).toBe("fail");
    expect(factual.findings.join(" ")).toContain("metric");
    expect(factual.findings.join(" ")).toContain("Python");
    expect(factual.findings.join(" ")).toContain("led");
  });
  it("blocks source mismatches, duplicate facts, banned phrases, and excluding every statement", () => {
    const pkg = fixturePackage();
    pkg.changes[0].factId = metadata().id;
    pkg.changes.push({ ...pkg.changes[1], id: metadata().id });
    pkg.coverLetter += " synergy";
    const reviews = runReviewers(pkg);
    expect(reviews.find((review) => review.reviewer === "Factual integrity")?.status).toBe("fail");
    expect(reviews.find((review) => review.reviewer === "Your voice")?.status).toBe("fail");
    pkg.changes = pkg.changes.map((change) => ({ ...change, decision: "rejected" }));
    expect(runReviewers(pkg)[0].status).toBe("fail");
  });
  it("keeps writing samples out of career facts and requires a measurable voice baseline", () => {
    expect(buildVoice(sampleVoice, 1).complete).toBe(true);
    const short = buildVoice({ ...sampleVoice, answers: sampleVoice.answers.map((answer) => ({ ...answer, text: "I like clear work." })) }, 2);
    expect(short.complete).toBe(false);
    expect(short.attributes.wordCount).toBeLessThan(80);
    expect(() => buildVoice({ ...sampleVoice, answers: [sampleVoice.answers[0], sampleVoice.answers[0]] }, 3)).toThrow();
    expect(() => buildVoice({ ...sampleVoice, answers: [{ promptId: "invented-prompt", text: "Not allowed." }] }, 3)).toThrow();
  });
});
