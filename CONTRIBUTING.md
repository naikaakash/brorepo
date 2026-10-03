# Contributing

This is a small personal learning project. The source is publicly readable, but write and deployment access are limited to approved maintainers.

1. Fork the repository and create a focused branch.
2. Run `npm ci` and `npx playwright install chromium`.
3. Run `npm run check` for BroCalc and `npm run check:applymate` for ApplyMate. CI checks both.
4. Open a pull request describing the behavior change and its tests.

Pull requests from forks run only the unprivileged CI workflow. The deployment workflow publishes **BroCalc only**. It runs only from `main`, validates that revision, and references a `production` environment secret. A maintainer must configure that environment's branch restrictions and repository protections before enabling deployment. No deployment credential belongs in pull-request jobs or client-side configuration.

The BroCalc API deployment has a standalone lockfile. After changing its dependencies, update it with `npm install --prefix api --workspaces=false --package-lock-only` as well as the root workspace lockfile. ApplyMate uses the root workspace lockfile.

ApplyMate development runs with `npm run dev:applymate`; its built preview requires `npm run build:applymate` followed by `npm run preview:applymate`. See [its README](applymate/README.md) for ports, persistence, and release gates. Keep `.applymate`, private resumes/BRDs, exports, email addresses, and credentials out of commits. Do not use real user data, SMTP, or model keys in tests.

ApplyMate's browser tests use their own in-memory API on 7073 and static preview on 4175, not the user's persistent instance on 7072/4174. Type checks include server tests and browser-test sources. Browser tests exercise Chromium at desktop and 320px mobile sizes; they do not establish complete accessibility or production readiness. Do not expose the local OTP preview or bypass the local-only server guards to publish the app.

No reuse license has been selected yet. Public visibility alone does not grant permission to copy or redistribute the project.
