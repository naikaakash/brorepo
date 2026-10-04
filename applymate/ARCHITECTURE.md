# Astra implementation map

This is the implementation map for the supplied ApplyMate Astra master specification.
It is a staged execution contract, not a claim that Auto Apply or production readiness
has been delivered.

## 1. Current architecture

React/Vite client and shared Zod contracts call an Express API. The API owns encrypted
candidate records and files in PGlite. Azure hosts the API and compiled client in one
Container App with Microsoft Easy Auth, Azure Files, Key Vault and a renewable Blob
lease. Local authentication is Better Auth email OTP. BroCalc remains a separate app.

## 2. What already works

Public landing, opt-in Microsoft signup, account-isolated workspaces, resume extraction
from PDF/DOCX/TXT, explicit fact confirmation and revision-safe merging, voice samples,
preferences, versioned answer library, imported jobs, evidence matching, grounded draft
generation, independent review, approved snapshots, PDF/DOCX export, manual application
timeline, encrypted provider keys, data export and fresh-signin account deletion.

## 3. What is partial

Profiles have six contact fields and categorized facts rather than the full structured
employment/education/preferences model. Matching is explainable but lexical. Answer
reuse uses normalized wording rather than semantic intent. Tailoring persists package
states but drains inside the API process; restart interrupts generation. Public signup
is bounded, but storage and worker execution remain single-instance.

## 4. What is missing

Controlled browser workspace, employer submissions, ATS adapters, orchestrator,
durable leased execution queue, independent workers, handoffs, employer credential
vault, managed inbox, automated status sources, job feeds, semantic matching, AI usage
accounting, staging, tested backups/restoration, managed database cutover and scale tests.
There is no browser extension in this repository to preserve or promote.

## 5. What should be reused

Keep the canonical profile, provenance, voice, answer versions, job model, encrypted
object store, immutable approved packages, application snapshots, shared validation,
ownership checks, provider gateway and current UI. Extend their contracts rather than
creating parallel profile or application systems. Preserve BroCalc unchanged.

## 6. What must be refactored

Make database access independent of embedded PGlite. Move package processing out of
the API only after atomic claiming and leased recovery exist. Replace Azure Files
binary storage with owned object storage after migration verification. Retire the
single-writer Blob lease only when the live database no longer resides on Azure Files.
Keep Auto/Hybrid unavailable until actual submission policy and adapters are tested.

## 7. Required database changes

Introduce versioned migrations and pooled PostgreSQL using the existing table names,
foreign keys, encrypted payloads and revision counters. Cloud identities are keyed by
tenant/object digest, not email. Future migrations add jobs/leases, workflow state,
handoffs, browser sessions, employer accounts, managed emails and AI usage. Retain
candidate records and immutable historical payloads; do not recreate them.

Moving the live database is a separate gated operation: stop writers, take an encrypted
consistent export, restore into an empty target with the original encryption key, verify
row counts and owned decryptability, test rollback, then switch the service. Never start
an empty PostgreSQL database as though existing pilot records have been migrated.

## 8. Required new services

Managed PostgreSQL, durable queue/orchestrator, independent document/AI workers,
isolated browser workers, ATS adapters, encrypted employer identity service, managed
inbound email, owned blob storage, job connectors and privacy-safe observability.
Each requires lifecycle, retention, authorization and failure-recovery boundaries.

## 9. Recommended production architecture

Client -> stateless authenticated API -> pooled PostgreSQL + owned object storage.
API -> durable queue -> orchestrator -> isolated worker -> ATS adapter.
Persist leases, state transitions and submission evidence. Use private networking,
managed secrets, database backup/PITR and separate staging/production resources.
Browser execution must not run in API requests. Require explicit user approval for
legal, demographic, MFA and CAPTCHA handoffs; never bypass protections.

## 10. Development phases

1. Foundation: pooled database, migrations, data-cutover tooling, tenant isolation,
   durable queue, workers, object storage, observability, staging and CI/CD.
2. Auto Apply core: durable state machine, controlled workspace, browser lifecycle,
   pause/resume/cancel and mock-site end-to-end tests.
3. ATS adapters: start with a bounded representative platform and expand coverage.
4. Employer identity: encrypted vault, approved account creation, inbox and verification.
5. Intelligence: structured profile gaps, semantic answer matching, policy and usage.
6. Status tracking: verified events, inbox classification and authorized portal checks.
7. Discovery: feeds, canonical source IDs, deduplication and search.
8. Hardening: load/failover, backup restoration, security review and cost controls.

## 11. Risks and dependencies

The personal Azure credit allowance is not a hard spending cap. Managed databases,
browser workers, inbound email and monitoring need an evaluated cost envelope before
provisioning. Google OAuth and inbound email require independently configured provider
credentials. ATS terms, rate limits and allowed automation vary; live submissions need
representative permitted integrations, not only mock tests. Browser cookies, screenshots
and inbox content are sensitive. Same-email Microsoft identities remain independent;
do not automatically relink historic data based on email.

Security review is a release gate before production cutover or employer automation.
Operational logging must remain free of resumes, answers, credentials and request bodies.
Current pilot backups, production monitoring and high availability are not provided.

## 12. Exact first implementation milestone

Deliver an opt-in, TLS-verified pooled PostgreSQL adapter for the existing storage/API,
versioned transactional migrations, preserved local PGlite behavior, real PostgreSQL
integration checks in CI, configuration examples and an explicit cutover gate.

The pilot remains on PGlite until a verified data migration, backup/restore test and cost
approval are complete. This milestone does not enable autonomous applications, remove
the cloud signup cap, claim horizontal safety for the current in-process tailoring queue,
or declare the product production-ready. Subsequent foundation work must remove that
worker constraint before increasing API replicas.
