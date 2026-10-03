# brorepo

Two personal full-stack learning projects, with separate frontends, backends, and run commands.

| Project | Scope | Local preview |
|---|---|---|
| **ApplyMate** | Resume-first candidate profiles, writing voice, job evidence, reviewed documents, and manual application tracking | `http://localhost:4174` |
| **BroCalc** | Scientific calculator backed by an Azure Functions API | `http://localhost:4173` |

## ApplyMate

The first local integrated milestone is implemented, not the entire commercial automation platform. It uses real passwordless sessions and persistent server-owned data. The default sign-in code appears in an explicitly local email preview; it does not send email or prove ownership of an external mailbox.

From the repository root:

```powershell
npm ci
npm run build:applymate
npm run preview:applymate
```

Open `http://localhost:4174`, use a test email, request a code, and select **Open local email preview**. Start with synthetic resume data.

See [ApplyMate setup, workflow, limitations, and hosting gates](applymate/README.md). Its frontend builds to static files, but the complete application also requires its API and persistent storage. **The Azure template and deployment workflow below deploy BroCalc only.** They do not publish ApplyMate.

The separate **Publish ApplyMate frontend preview** workflow publishes a GitHub Pages landing preview from `feat/applymate`. This public build makes no API requests and accepts no personal data; account and document workflows remain available locally.

## BroCalc

A polished scientific calculator with a React + TypeScript frontend and a bounded TypeScript API designed for Azure Static Web Apps managed Functions.

### What it demonstrates

- Responsive dark/light calculator UI with keyboard input and session-only history
- Real backend calculations through `POST /api/calculate`
- Arithmetic, powers, parentheses, factorial, percent, square root, logarithms, trigonometry, inverse trigonometry, and DEG/RAD modes
- A restricted parser with no `eval`, arbitrary code execution, variables, assignments, or implicit multiplication
- Request, expression, token, nesting, domain, and finite-number limits
- GitHub Actions CI, desktop/mobile browser tests, and a manually triggered Azure Static Web Apps deployment

### Local setup

Use Node.js 22.12+ (22 LTS) or Node.js 24. CI and the Azure API use Node.js 22. Azure Functions Core Tools v4 is installed locally by `npm ci`; no global installation is needed.

```powershell
git clone git@github.com:naikaakash/brorepo.git
Set-Location brorepo
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the Functions host on port 7071.

Frontend edits reload automatically. After changing API code, restart `npm run dev` to rebuild it. This HTTP-only API needs no storage emulator, database, Azure credentials, or `local.settings.json`. Core Tools can emit an unused-storage health warning; the HTTP endpoint is the relevant readiness check.

Keep ports 5173, 4173, and 7071 free for development/tests. Local servers are not public hosting.

### Commands

The commands in this table target BroCalc. ApplyMate uses the separate `:applymate` commands documented above.

| Command | Purpose |
|---|---|
| `npm run dev` | Run the API and frontend locally |
| `npm run lint` | Lint both workspaces |
| `npm run typecheck` | Type-check both workspaces |
| `npm test` | Run API and component tests |
| `npm run build` | Build the API and production frontend |
| `npm run package:api` | Package an already-built API with locked production-only dependencies |
| `npm run test:e2e` | Build/package, start the real API and production frontend, and run browser tests |
| `npm run check` | Run lint, type checks, unit/component tests, build, and browser tests |

Before the first browser run:

```powershell
npx playwright install chromium
npm run check
```

Tests use Chromium at desktop and 320px mobile sizes; mobile emulation is not a claim of testing Safari on a physical iPhone. They cover real scientific calculations, history, errors, editing, cancellation, timeouts, full results, and automated accessibility checks in both themes. Automated checks are not a complete accessibility certification. No browser recordings or traces are retained.

### API

Request:

```http
POST /api/calculate
Content-Type: application/json

{"expression":"sin(30)","angleMode":"DEG"}
```

Success:

```json
{"result":0.49999999999999994,"formattedResult":"0.5"}
```

Only `POST` with `Content-Type: application/json` is accepted. Both `expression` and `angleMode` are required; unknown fields are rejected. Responses include `Cache-Control: no-store`.

The API accumulates at most 4 KiB, cancelling the stream when a chunk would exceed that bound; transport/runtime buffering is separate. It accepts 256 expression characters, 128 tokens, and 16 nested recursive operations (parentheses, functions, unary signs, and powers share this budget).

Errors have the shape `{"error":{"code":"DOMAIN_ERROR","message":"..."}}`: HTTP 400 for invalid requests or math, 405 with `Allow: POST` for unsupported methods, 413 for excessive bodies, 415 for the wrong media type, and 500 for unexpected failures.

Supported syntax:

- Operators: `+`, `-`, `*`, `/`, `^`, postfix `%`, postfix `!`
- Constants: `pi`, `e`
- Functions: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `sqrt`, `log`, `ln`
- Explicit multiplication only: use `2*pi`, not `2pi`

Semantics:

- Postfix operators bind first; exponentiation is right-associative and binds more tightly than unary signs. `-2^2 = -4`, `2^3^2 = 512`, and `2^-2 = 0.25`.
- `%` always divides by 100: `200+10% = 200.1`. Repeated postfix operators apply sequentially, not as a double-factorial operation.
- Factorial supports integers from 0 through 170. `0! = 1`; `0^0 = 1` follows the chosen numeric convention.
- The initial mode is RAD. DEG affects trig input and inverse-trig output; degrees are reduced modulo 360 before conversion to avoid overflow.
- Tangent is rejected when `abs(cos(angle)) < 1e-12`. Inverse sine/cosine require inputs from -1 to 1; roots/logarithms enforce their real-valued domains.
- Non-finite inputs, intermediate values, and results are rejected. Finite binary floating-point arithmetic may round or underflow; this is not arbitrary-precision or financial math.
- Results display up to 15 significant digits, using scientific notation for extreme magnitudes and normalizing negative zero.

The server is authoritative. The browser never computes a fallback answer, sends no per-keystroke calculation requests, cancels stale work when input/mode changes, and times out after eight seconds. History holds at most 12 entries in memory.

### Privacy and operational logging

BroCalc contains no analytics SDK, telemetry integration, advertising, external fonts, database, account system, or persistent calculation history. History exists only in React memory and disappears on refresh. ApplyMate has its own persistent account and document data; see its separate privacy and storage notes.

Normal local process output and standard GitHub/Azure security, access, build, and deployment logs may still exist. Those platform logs are outside the application's control. Core Tools telemetry is opted out for local startup. No Application Insights resource is provisioned. The only application diagnostic is a fixed message for unexpected failures; it contains no expression, body, or exception details.

### Azure deployment (BroCalc only)

The included Bicep creates only an Azure Static Web Apps **Free** resource. Review names, region availability, permissions, policy, and current pricing before running it:

```powershell
az deployment group what-if `
  --subscription <personal-subscription-id> `
  --resource-group <personal-resource-group> `
  --template-file infra\main.bicep `
  --parameters name=<globally-unique-name>
```

Resource creation and public publishing are separate, explicit approvals. The template does not create a resource group, add Application Insights, or purchase a domain. After reviewing the `what-if`, use `az deployment group create` with the same arguments to create the single resource.

After an explicitly approved resource creation:

1. Store the Static Web Apps deployment token as the `production` environment secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.
2. Restrict the `production` environment to the `main` branch and authorized maintainers. Add branch protection requiring the `validate` CI check; a solo-maintainer setup need not require a second approver.
3. Run the `Deploy Azure Static Web App` workflow manually from a trusted `main` revision.

The deployment workflow independently runs `npm run check` on its exact revision, then uploads the frontend build and the same production API package exercised by the browser tests. Both Azure-side builds are skipped; `staticwebapp.config.json` selects `node:22`. The API's standalone lockfile allows a production-only install without shipping the repository's development dependencies. When API dependencies change, update both the root lockfile and `api/package-lock.json` (`npm install --prefix api --workspaces=false --package-lock-only`).

Do not place the deployment token in source, workflow output, browser configuration, or pull-request jobs. The checked-in workflows do not themselves create GitHub environment or branch protections; those must be configured separately. There are no fork preview deployments.

Free plans have quotas and no SLA; an anonymous public API can exhaust those quotas under abuse. Request bounds limit individual work, not aggregate traffic. CORS and client-side secrets are not authentication or distributed rate limits.

To stop public access, delete the specific Static Web App resource using its verified resource ID, or deploy a maintenance configuration that blocks requests. Disabling GitHub Actions alone does **not** take an existing site offline. To roll back, revert the faulty change through a new trusted `main` revision and run the deployment workflow; do not rewrite branch history or bypass validation.

For post-deployment browser checks, set `E2E_BASE_URL` to the public HTTPS origin and run `npx playwright test`. Without that variable, tests use only local servers.

## License

No license has been selected. The repository is public for inspection and learning, but public visibility does not itself grant reuse rights.
