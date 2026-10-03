# Contributing

This is a small personal learning project. The source is publicly readable, but write and deployment access are limited to approved maintainers.

1. Fork the repository and create a focused branch.
2. Run `npm ci`, `npx playwright install chromium`, and `npm run check`.
3. Open a pull request describing the behavior change and its tests.

Pull requests from forks run only the unprivileged CI workflow. Deployment runs only from `main`, validates that revision, and references a `production` environment secret. A maintainer must configure that environment's branch restrictions and repository protections before enabling deployment. No deployment credential belongs in pull-request jobs or client-side configuration.

API deployments have a standalone lockfile. After changing API dependencies, update it with `npm install --prefix api --workspaces=false --package-lock-only` as well as the root workspace lockfile.

No reuse license has been selected yet. Public visibility alone does not grant permission to copy or redistribute the project.
