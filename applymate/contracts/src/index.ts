import { z } from "zod";

export const policyVersion = "local-evaluation-2026-10-03";
export const limits = { uploadBytes: 5 * 1024 * 1024, documents: 30, jobs: 200, dailyPackages: 20 };
export const idSchema = z.string().uuid();
const text = (max = 2000) => z.string().trim().max(max);
const timestamp = z.string().datetime();
export const metaSchema = z.object({ id: idSchema, createdAt: timestamp, updatedAt: timestamp });
export const factStateSchema = z.enum(["proposed", "verified", "rejected"]);
export const provenanceSchema = z.object({
  kind: z.enum(["resume", "manual", "account"]),
  documentId: idSchema.optional(),
  excerpt: text(2000),
  confidence: z.number().min(0).max(1)
});
export const profileFieldSchema = z.object({
  value: text(500), state: factStateSchema, source: provenanceSchema
});
export const fieldNames = ["fullName", "email", "phone", "location", "headline", "website"] as const;
export type FieldName = typeof fieldNames[number];
export const factSchema = metaSchema.extend({
  category: z.enum(["experience", "education", "skill", "certification", "project", "achievement", "summary", "other"]),
  text: text(2000).min(1),
  state: factStateSchema,
  source: provenanceSchema
});
export const profileSchema = metaSchema.extend({
  revision: z.number().int().nonnegative(),
  fields: z.object({
    fullName: profileFieldSchema, email: profileFieldSchema, phone: profileFieldSchema,
    location: profileFieldSchema, headline: profileFieldSchema, website: profileFieldSchema
  }),
  facts: z.array(factSchema).max(250),
  documentIds: z.array(idSchema).max(limits.documents),
  onboardingStep: z.enum(["upload", "review", "gaps", "voice", "preferences", "complete"])
});
export const profileUpdateSchema = z.object({
  revision: z.number().int().nonnegative(),
  fields: z.object({
    fullName: text(500), email: text(500), phone: text(500),
    location: text(500), headline: text(500), website: text(500)
  }),
  facts: z.array(z.object({
    id: idSchema, text: text(2000).min(1), category: factSchema.shape.category, state: factStateSchema
  })).max(250),
  confirm: z.boolean()
}).strict();
export const documentSchema = metaSchema.extend({
  name: text(200), mime: text(100), size: z.number().int().nonnegative(),
  text: text(100000), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  warnings: z.array(text(500)), imported: z.boolean(),
  proposedFields: profileSchema.shape.fields, proposedFacts: profileSchema.shape.facts
});
export const preferenceSchema = metaSchema.extend({
  roles: z.array(text(100)).max(20), locations: z.array(text(100)).max(20),
  workStyle: z.enum(["any", "remote", "hybrid", "onsite"]),
  salaryMinimum: z.number().nonnegative().max(10000000).nullable(),
  currency: z.enum(["USD", "EUR", "GBP", "CAD", "INR"]),
  excludedCompanies: z.array(text(100)).max(100),
  mode: z.enum(["Review", "Hybrid", "Auto"]), hybridThreshold: z.number().int().min(50).max(100),
  dailyLimit: z.number().int().min(1).max(limits.dailyPackages),
  notifications: z.boolean()
});
export const voicePrompts = [
  { id: "motivation", title: "What makes work feel worthwhile?", question: "In your own words, what do you enjoy about your work? No need to repeat your resume." },
  { id: "pride", title: "Tell it like you would to a friend", question: "Choose one result from your experience. Why did it matter to you?" },
  { id: "challenge", title: "When things got complicated", question: "How would you describe a tricky problem and the way you approached it?" },
  { id: "team", title: "Your collaboration style", question: "What is it like to work alongside you? Use a real example if you like." },
  { id: "learning", title: "How you learn", question: "Tell us about something you enjoyed learning and how you went about it." },
  { id: "feedback", title: "Making things better", question: "How do you prefer to give and receive feedback?" },
  { id: "values", title: "What you look for", question: "What makes a team or workplace feel like a good fit for you?" },
  { id: "explain", title: "Make it simple", question: "Explain a familiar part of your work to someone outside your field." },
  { id: "intro", title: "A natural introduction", question: "Write the short introduction you would actually send to a hiring manager." },
  { id: "strength", title: "Quiet confidence", question: "What would you like a new teammate to know about your strengths?" },
  { id: "avoid", title: "Not your voice", question: "Which phrases or writing styles would you never use? Tell us why." },
  { id: "next", title: "Your next chapter", question: "In a few sentences, what would you like to do next, and what draws you to it?" }
] as const;
export const voiceSchema = metaSchema.extend({
  version: z.number().int().positive(),
  answers: z.array(z.object({ promptId: z.string(), text: text(5000) })).max(12),
  polish: z.enum(["Preserve My Style", "Natural Professional", "Highly Polished"]),
  preferredPhrases: z.array(text(150)).max(30), bannedPhrases: z.array(text(150)).max(30),
  attributes: z.object({
    averageSentenceWords: z.number(), wordCount: z.number().int(),
    contractions: z.boolean(), directness: text(100), formality: text(100)
  }),
  complete: z.boolean()
});
export const voiceUpdateSchema = voiceSchema.pick({
  answers: true, polish: true, preferredPhrases: true, bannedPhrases: true
}).strict();
export const answerSchema = metaSchema.extend({
  question: text(500).min(5), normalizedQuestion: text(500),
  versions: z.array(z.object({
    version: z.number().int().positive(), answer: text(5000).min(1),
    confirmedAt: timestamp, source: text(200),
    sensitivity: z.enum(["standard", "sensitive"]), reuse: z.enum(["ask", "approved"])
  })).min(1).max(100)
});
export const answerInputSchema = z.object({
  question: text(500).min(5), answer: text(5000).min(1),
  sensitivity: z.enum(["standard", "sensitive"]), reuse: z.enum(["ask", "approved"])
}).strict();
export const requirementSchema = z.object({
  id: idSchema, text: text(1500), priority: z.enum(["required", "preferred"]),
  status: z.enum(["supported", "partial", "missing", "unknown"]),
  factIds: z.array(idSchema), rationale: text(1000), keywords: z.array(text(100))
});
export const jobInputSchema = z.object({
  title: text(200).min(2), company: text(200).min(2), location: text(200),
  workStyle: z.enum(["unknown", "remote", "hybrid", "onsite"]),
  salaryMinimum: z.number().nonnegative().max(10000000).nullable(),
  salaryMaximum: z.number().nonnegative().max(10000000).nullable(),
  currency: preferenceSchema.shape.currency,
  sourceUrl: z.union([z.literal(""), z.url().max(2000).refine((value) => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS URL.")]),
  description: text(30000).min(80)
}).strict().refine((job) => job.salaryMinimum === null || job.salaryMaximum === null ||
  job.salaryMinimum <= job.salaryMaximum, "Salary minimum must not exceed maximum.");
export const jobSchema = metaSchema.extend({
  ...jobInputSchema.shape,
  fingerprint: text(64), state: z.enum(["saved", "dismissed"]),
  declineReason: text(500),
  analysis: z.object({
    method: z.literal("Evidence-based lexical analysis"),
    profileRevision: z.number().int(), score: z.number().min(0).max(100),
    hardFilters: z.array(text(500)), requirements: z.array(requirementSchema).max(40)
  })
});
export const reviewSchema = z.object({
  reviewer: z.enum(["Factual integrity", "Your voice", "ATS readability", "Independent model reviewer"]),
  status: z.enum(["pass", "fail"]), method: text(150), findings: z.array(text(1000))
});
export const changeSchema = z.object({
  id: idSchema, factId: idSchema, section: factSchema.shape.category,
  original: text(2000), proposed: text(2000).min(1), reason: text(1000),
  keywords: z.array(text(100)).max(30), decision: z.enum(["pending", "approved", "rejected"])
});
export const packageSchema = metaSchema.extend({
  jobId: idSchema, sourceDocumentId: idSchema.nullable(), profileRevision: z.number().int(),
  voiceId: idSchema, version: z.number().int().positive(),
  state: z.enum(["queued", "generating", "reviewing", "needs_review", "blocked", "approved", "failed"]),
  engine: text(200), error: text(1000),
  candidate: z.object({ fullName: text(500), email: text(500), phone: text(500), location: text(500), headline: text(500), website: text(500).optional() }),
  facts: z.array(factSchema), voice: voiceSchema, job: jobSchema,
  changes: z.array(changeSchema).max(250), reviews: z.array(reviewSchema),
  coverLetter: text(12000), approvedAt: timestamp.nullable(),
  hash: text(64)
});
export const applicationStates = [
  "Awaiting Approval", "Human Action Required", "Submitted", "Under Review",
  "Assessment", "Interview", "Rejected", "Withdrawn", "Offer", "Closed"
] as const;
export const applicationSchema = metaSchema.extend({
  jobId: idSchema, packageId: idSchema, state: z.enum(applicationStates),
  snapshot: packageSchema, answers: z.array(answerSchema),
  timeline: z.array(z.object({ at: timestamp, type: text(100), message: text(1200), evidence: text(2000).optional() })),
  evidence: z.object({
    kind: z.literal("User-reported confirmation"), reference: text(2000).min(5), at: timestamp
  }).nullable()
});
export const connectionSchema = metaSchema.extend({
  provider: z.enum(["openai", "gemini"]), model: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._/-]+$/),
  suffix: z.string().max(4), testedAt: timestamp.nullable(), status: z.enum(["untested", "connected", "failed"])
});
export const connectionInputSchema = connectionSchema.pick({ provider: true, model: true }).extend({
  apiKey: z.string().trim().min(16).max(500), consent: z.literal(true)
}).strict();
export const activitySchema = metaSchema.extend({ action: text(120), objectId: text(100), detail: text(500) });
export const capabilitySchema = z.object({
  localOnly: z.boolean(), mailMode: z.enum(["local", "smtp", "microsoft"]), engine: text(200),
  automation: z.literal(false), managedInbox: z.literal(false), billing: z.literal(false),
  limits: z.object({ documents: z.number(), jobs: z.number(), dailyPackages: z.number() })
});
export const objectSchemas = {
  profile: profileSchema, document: documentSchema, preferences: preferenceSchema, voice: voiceSchema,
  answer: answerSchema, job: jobSchema, package: packageSchema, application: applicationSchema,
  connection: connectionSchema, activity: activitySchema
};
export type ObjectKind = keyof typeof objectSchemas;
export type EntityMap = { [K in ObjectKind]: z.infer<(typeof objectSchemas)[K]> };
export type Profile = z.infer<typeof profileSchema>;
export type CandidateFact = z.infer<typeof factSchema>;
export type ProfileField = z.infer<typeof profileFieldSchema>;
export type Preferences = z.infer<typeof preferenceSchema>;
export type Voice = z.infer<typeof voiceSchema>;
export type Job = z.infer<typeof jobSchema>;
export type ApplicationPackage = z.infer<typeof packageSchema>;
export type Application = z.infer<typeof applicationSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type DocumentRecord = z.infer<typeof documentSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Change = z.infer<typeof changeSchema>;
export const workspaceSchema = z.object({
  user: z.object({ id: z.string(), email: z.email(), name: z.string() }),
  profile: profileSchema, preferences: preferenceSchema, voice: voiceSchema.nullable(),
  documents: z.array(documentSchema.omit({ text: true, proposedFields: true, proposedFacts: true })),
  jobs: z.array(jobSchema),
  packages: z.array(packageSchema.omit({ candidate: true, facts: true, voice: true, job: true, changes: true, coverLetter: true })),
  applications: z.array(applicationSchema.omit({ snapshot: true, answers: true }).extend({ title: text(200), company: text(200) })),
  answers: z.array(answerSchema), connections: z.array(connectionSchema),
  activity: z.array(activitySchema), capabilities: capabilitySchema
});
export type Workspace = z.infer<typeof workspaceSchema>;
export { z };
