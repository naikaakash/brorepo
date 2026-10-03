# ApplyMate

A local, resume-first application workspace built with React/TypeScript, an Express API, Better Auth, and embedded PostgreSQL through PGlite. This is the first integrated intelligence milestone, not a finished commercial auto-apply service.

## Run locally

Use the repository's supported Node.js versions: 22.12+ within Node 22, or Node 24. Run commands from the repository root:

```powershell
npm ci
npm run build:applymate
npm run preview:applymate
```

Open `http://localhost:4174`. Keep both processes running; the static frontend alone cannot authenticate users, save data, or generate documents. Stop the preview with Ctrl+C.

For development with automatic reload:

```powershell
npm run dev:applymate
```

| Mode | Frontend | API | Storage |
|---|---|---|---|
| Development | `http://localhost:5174` | `http://127.0.0.1:7072` | `.applymate\local` |
| Built preview | `http://localhost:4174` | `http://127.0.0.1:7072` | `.applymate\local` |
| Browser tests | `http://127.0.0.1:4175` | `http://127.0.0.1:7073` | Isolated, in-memory |

Do not run development and the built preview simultaneously against the same data directory. A process lock prevents concurrent owners. Both modes are separate from BroCalc's 5173/4173 frontend and 7071 API.

## Try the complete workflow

1. Enter a test email, acknowledge local evaluation, and request a sign-in code. Choose **Open local email preview**, then verify the code. No email is sent by default.
2. Upload a synthetic PDF, DOCX, or UTF-8 text resume. Inspect the proposed contact details and facts, including source references and confidence. Correct or exclude inaccurate proposals and explicitly confirm the facts to use. Already-confirmed contact details are collapsed during onboarding.
3. Answer the contextual writing prompts and save a Voice Profile. The usable baseline requires at least three substantial answers and 80 total words; all twelve prompts give a broader sample. Complete preferences and hard filters.
4. Paste a job description in Jobs. Inspect the requirement-to-fact evidence map and any hard-filter violations.
5. Create a draft and open the side-by-side review. Save a decision for every statement. Factual, voice, and ATS checks must pass before you acknowledge approval and lock the snapshot.
6. Download the approved resume and cover letter as PDF or DOCX. Prepare an application record; this does **not** send an application.
7. Record manual status changes with supporting notes and references. The timeline retains prior evidence. Export workspace data or delete the local account from Settings.

The Answer Library supports versioned user-confirmed responses. Only the latest explicitly reusable, standard-sensitivity answer versions enter a new application snapshot. Sensitive answers require confirmation and are not automatically reused.

## What is implemented

| Area | Behavior |
|---|---|
| Authentication | Expiring, single-use email codes; persistent cookie sessions; consent and request-origin checks; fresh sign-in for sensitive actions |
| Candidate data | Persistent owned profiles, original resumes, typed fact proposals, explicit confirmation, and revision-checked selected merges |
| Voice | Contextual writing interview and immutable saved Voice Profile versions |
| Jobs | Manual import, hard filters, conservative lexical evidence mapping, and saved requirements |
| Documents | Durable local generation queue, independent check steps, saved review decisions, immutable approved snapshots, and actual PDF/DOCX files |
| Applications | Saved job/profile/voice/document/answer snapshots and evidence-bearing, user-reported timelines |
| Settings | Optional model connections, workspace JSON export, and deletion of live account data |

There is no managed application inbox, employer-account vault, background employer submission, inbox classification, job-board crawler, payment system, or unattended Auto/Hybrid mode. Unsupported capabilities are disclosed instead of represented by working-looking mock activity.

## Evidence, review, and export limits

The default engine makes no AI calls. It selects and formats confirmed evidence with job-relevant keyword emphasis; it does not invent new achievements. Requirement matching is lexical and intentionally conservative, not embedding search, a hiring probability, or a claim that every requirement is satisfied.

The factual, voice, and ATS checks are separate, bounded checks. They can detect the implemented categories of unsupported claims, metrics, tone violations, and structural problems; they are not universal truth verification, a proof of authorship, or certification against an employer's ATS. Review the actual source facts and final documents yourself.

Uploads are limited to 5 MB. PDFs must contain extractable text and have at most 20 pages; OCR is not implemented. DOCX extraction is bounded to 500 ZIP entries and 32 MB expanded content. Extraction runs in a bounded worker, with a 15-second timeout and a 100,000-character text limit. Damaged, textless, or oversized documents fail explicitly.

PDF output uses bundled Roboto fonts. Characters outside their glyph coverage are rejected with an explicit DOCX alternative instead of silently disappearing. DOCX retains broader Unicode text, but its visual rendering still depends on the reader and available fonts.

Approval locks the structured package snapshot. `packageHash` and the download's `X-Document-Hash` identify that snapshot, **not the generated file bytes**. Regenerating a PDF or DOCX may change container metadata. Editing the candidate facts, voice, or preferences does not rewrite approved snapshots or historical application records.

Application creation starts in **Human Action Required**, never Submitted. Later external status claims require user-provided evidence. They are user-reported updates, not independently verified employer events.

## Private local storage

The default private directory is `.applymate\local` at the repository root. It contains `postgres`, `local-encryption.key`, and a runtime lock. It is ignored by Git.

Domain payloads, original-file contents, and stored provider keys use authenticated encryption bound to their owner and record identity. Core authentication columns, including account email and session data, are **not** payload-encrypted. The local key lives beside the database; this is not managed secret storage and does not protect against someone who can read both. Protect the directory with your operating-system permissions and disk protection.

To back up or restore, stop the API and copy the database and its **matching original key** together into protected storage. If `APPLYMATE_DATA_KEY` supplies the key instead, back up that secret separately. A missing or mismatched key causes startup to fail; do not generate a replacement for an existing database. Restore the original key or deliberately choose a different, empty `APPLYMATE_DATA_DIR` for a separate workspace. The app does not perform key rotation or migrate an existing workspace into a newly chosen directory.

The local inbox is memory-only and disappears on restart; request a new code if needed. Account sessions and saved records persist. The default inbox preview permits obtaining a code for a test address without access to that external mailbox, so **it is not proof of mailbox ownership** and must never be exposed publicly.

Workspace JSON export is a readable data export, not an encrypted database backup. Original resumes and approved documents have separate downloads. Deleting an account removes its live owned records and sessions; it cannot retract files already downloaded, backups, delivered email, or information already shared with a model provider.

The application has no analytics integration or request-body logging, and authentication telemetry is disabled. Fixed operational error messages and normal local, GitHub, provider, or hosting logs may still exist. The product's saved activity and application timelines are local application functionality.

## Optional configuration

Set environment variables in the process that starts the API; its entrypoint does not automatically load `.env` files. Never put secrets in `VITE_*` variables, public assets, source code, or commits.

| Variable | Purpose |
|---|---|
| `APPLYMATE_DATA_DIR` | Private storage directory; relative paths resolve from the repository root |
| `APPLYMATE_DATA_KEY` | Optional base64-encoded 32-byte key instead of `local-encryption.key`; an existing database must retain its original key |
| `APPLYMATE_PORT` | API port; defaults to 7072 |
| `APPLYMATE_ORIGIN` | Local authentication origin; defaults to `http://localhost:4174` |
| `APPLYMATE_API_URL` | Built frontend preview's API proxy target; needed if changing the API port |
| `APPLYMATE_SMTP_URL` | Optional SMTP transport URL; may contain credentials |
| `APPLYMATE_SMTP_FROM` | Required sender address when SMTP is enabled |

The development proxy uses 7072. Prefer the defaults; changing the API port also requires adjusting the development proxy. The API intentionally rejects production mode and non-loopback hosting/origins. Do not disable those guards or tunnel this server to publish it.

SMTP mode sends real verification email and disables the local inbox preview. Configure an account and sender you control; no mail provider or domain is provisioned automatically.

### Optional model connections

Settings supports user-supplied OpenAI or Gemini keys and model IDs. Saving a connection requires sharing consent and a fresh sign-in; testing it makes a real provider request that may cost money. Credentials remain server-side and only masked connection metadata reaches the browser.

Each model-assisted generation requires separate consent to send the relevant confirmed facts, job description, and writing samples. Generation uses structured output plus a separate model review, as well as the local checks. Saving changed review decisions can make another paid checker request. There is no claim that provider retention is disabled universally; the OpenAI request includes `store: false`, but the provider's other retention and account policies still apply.

Calls use fixed provider endpoints, bounded requests/responses, timeouts, and no automatic paid retries. Refusals, malformed output, unsupported models, and provider errors fail explicitly. Interrupted provider work fails rather than being silently repeated after a restart. The daily package limit defaults to five, can be set from one to twenty, and counts failed generations.

Automated tests use mocked provider responses and do not establish compatibility with every live model or validate a real SMTP account.

## Validation

```powershell
npx playwright install chromium
npm run check:applymate
```

| Command | Scope |
|---|---|
| `npm run typecheck:applymate` | Contracts, server including tests, client, and browser-test sources |
| `npm run test:applymate` | API, persistence, parser/export, provider transport, intelligence, and client tests |
| `npm run build:applymate` | Contracts, executable Node API, and static frontend assets |
| `npm run test:e2e:applymate` | Real browser workflow against an isolated API; build first |
| `npm run check:applymate` | Type checks, lint, unit/component tests, builds, and browser tests |

Browser tests use synthetic data, their own ephemeral database, and disabled external model calls. They do not touch the persistent preview or use SMTP. They exercise desktop and 320px mobile Chromium, real PDF/DOCX upload/download, merges, review/approval, account isolation/deletion, errors, and keyboard interaction. Automated accessibility scans are included; this is not a complete accessibility certification or a physical Safari test.

## Static website and Azure publishing

The GitHub Pages release is an explicitly **frontend-only public preview**. It shows the landing page and local setup link without calling an API or accepting email addresses or resumes. The `Publish ApplyMate frontend preview` workflow publishes pushes on `main`; it builds with `VITE_PUBLIC_PREVIEW=true`, repository-relative assets, and a separate `dist-public` directory so it does not replace the local full-stack build. It never uploads `.applymate`, backend data, or private documents.

The local build remains fully interactive. Public sign-in and saved-data features are not enabled by this Pages release.

`npm run build:applymate` produces a static frontend in `applymate\client\dist`. Public static hosting can serve those files, but the current client also expects a same-origin `/api`. Uploading only the frontend does not provide authentication, persistence, queues, or document generation.

For an Azure release, a possible architecture is Static Web Apps for the frontend, a separately hosted Node API/worker, managed PostgreSQL, protected document storage, a managed secret store, and a real email provider. [Microsoft's API integration documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-overview) distinguishes built-in Functions from bring-your-own backends; linking an existing App Service or Container Apps API requires Static Web Apps Standard. The existing Express/PGlite runtime is not a drop-in stateless managed Function.

Before public deployment, implement and verify production database/storage adapters and migrations, managed keys, HTTPS authentication and cookie configuration, delivered-email ownership, shared abuse controls, durable background execution, backups/restoration, and retention/consent controls. Choose the resources and review their current cost before provisioning. These are release gates, not settings already enabled by this prototype.

**No ApplyMate Azure deployment is included or enabled.** The repository's `infra\main.bicep` and deployment workflow package **BroCalc only**. They do not upload ApplyMate, its local database, keys, or private documents.
