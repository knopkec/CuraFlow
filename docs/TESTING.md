# Testing Guide

CuraFlow ships with automated **unit**, **component**, and **headless end-to-end** coverage. This guide documents the current test stack, the local workflows, and the rules for adding new tests without making the suite brittle.

## Test stack

| Layer | Tooling | Primary location | Purpose |
| --- | --- | --- | --- |
| Unit | Vitest | `src/**/__tests__/`, `server/**/__tests__/` | Pure utilities, small server helpers, deterministic logic |
| Component | Vitest + React Testing Library + MSW | `src/**/__component_tests__/` | UI workflows with mocked API/state boundaries |
| E2E | Playwright | `e2e/specs/**` | Browser workflows against the real Express + MySQL harness |

## Local commands

| Command | What it does |
| --- | --- |
| `npm run test:unit` | Runs the Vitest unit project |
| `npm run test:component` | Runs the component project in `happy-dom` |
| `npm run test:coverage` | Runs unit + component coverage and writes the HTML report to `coverage/index.html` |
| `npm run test:e2e` | Runs the Playwright suite against the deterministic Docker-backed harness |
| `npm run test:e2e:repeat` | Re-runs the Playwright suite with `--repeat-each=2` for flake detection |
| `npm run test:e2e:ui` | Opens Playwright UI mode locally |
| `npm run test:e2e:install` | Installs the required Playwright browser binaries |
| `npm run test:db:up` | Starts the MySQL + backend E2E harness |
| `npm run test:db:seed` | Seeds the deterministic master + tenant data set |
| `npm run test:db:down` | Stops and removes the E2E harness |

For frontend or shared runtime changes, the normal local validation path is:

```bash
npm run build
npm run test:unit
npm run test:component
```

For UI workflow changes, also run:

```bash
npm run test:e2e
```

## E2E harness

Playwright does **not** run against mocked data. It boots:

1. the Vite frontend,
2. the Express backend from `server/`,
3. a MySQL 8.4 test database,
4. a deterministic seed created by `server/scripts/seed-test-data.js`.

### Optional local test environment file

`.env.test` is optional and git-ignored. If present, the helper scripts load it automatically through `scripts/load-test-env.js`.

Start from:

```bash
cp .env.test.example .env.test
```

Required variables:

```dotenv
TEST_MYSQL_ROOT_PASSWORD=
TEST_MYSQL_PASSWORD=
TEST_JWT_SECRET=
SEED_ADMIN_PASSWORD=
SEED_USER_PASSWORD=
SEED_READONLY_PASSWORD=
```

Never commit `.env.test` or hard-code seeded passwords in source files, docs, tests, or workflows.

### Seeded user roles

The deterministic harness creates one account per role:

| Role | Email |
| --- | --- |
| Admin | `admin@test.local` |
| User | `user@test.local` |
| Read-only | `readonly@test.local` |

Passwords come from the `SEED_*_PASSWORD` environment variables, locally or in CI.

## Repository layout for tests

```text
e2e/
  fixtures/        shared Playwright fixtures
  pages/           page objects
  specs/           workflow specs grouped by feature
  support/         seeded config, API helpers

src/**/__tests__/              Vitest unit tests
src/**/__component_tests__/    Vitest + RTL component tests
src/test-utils/                shared RTL/MSW setup
server/**/__tests__/           backend unit/integration-style tests
```

## Choosing the right test level

Use the smallest layer that still proves the behavior you need:

- **Unit test** for pure helpers, parsers, business rules, and migration helpers.
- **Component test** for a focused UI flow that can be exercised with mocked API boundaries.
- **Playwright** for cross-page flows, persistence checks, auth/role behavior, downloads, realtime, and interactions that depend on the real backend.

Do not push everything into E2E. E2E should cover **critical workflows**, not every branch of every component.

## Authoring rules

### 1. Assert workflows, not markup trivia

Good tests prove outcomes such as:

- a user can create a doctor and the new row persists,
- an admin setting survives a reload,
- a realtime update appears in another browser context,
- a download is triggered with the expected file type.

Avoid brittle assertions on implementation-only structure.

### 2. Selector priority

Use selectors in this order:

1. `getByRole(...)`
2. `getByLabel(...)`
3. Stable text only when the text is the actual contract
4. `data-testid` when the UI has no robust semantic hook

When adding `data-testid`, keep it:

- feature-scoped,
- kebab-case,
- stable across refactors,
- descriptive enough to stand on its own.

Examples:

- `staff-form-submit`
- `admin-user-create-button`
- `statistics-export-pdf`

### 3. Use page objects for browser workflows

Playwright specs should keep locator details in `e2e/pages/**`. Specs should read like workflow descriptions and use the shared fixtures from `e2e/fixtures/auth.ts`.

### 4. Arrange through API when possible

For Playwright, prefer:

- arrange via seeded data or API helpers,
- perform the **actual behavior under test** through the UI,
- assert through both UI and persisted backend state when it matters.

### 5. Keep tests deterministic

- No random data without a unique prefix or suffix.
- No arbitrary sleeps; use Playwright polling or RTL async queries.
- Clean up records created by mutating tests.
- If a mutating Playwright flow is unsafe across browser projects, scope it explicitly (for example Chromium-only) and document why in the test.

## Coverage policy

Coverage is **advisory**, not a merge gate by itself.

Current policy:

- New or meaningfully changed code should reach **>= 80% line coverage**
- Critical paths should reach **>= 95% line coverage**

Critical paths include:

- auth flows and token handling,
- scheduling logic,
- the cost function and closely related scheduling utilities.

### Local coverage run

```bash
npm run test:coverage
open coverage/index.html
```

### CI coverage advisory

The `CI` workflow publishes a coverage summary to the GitHub Actions step summary. It is intentionally **non-blocking** so the repo can surface coverage trends without turning pre-existing baseline gaps into red PRs.

Important limitation:

- the workflow can summarize repository coverage and selected critical files,
- it **cannot automatically infer “new code only”** from the PR diff,
- reviewers still need to apply the `>= 80% for new code` rule to the files changed in the PR.

## CI workflows

### `CI`

Runs the fast, always-on checks:

- `npm run build`
- `npm run test:unit`
- `npm run test:component`

It also runs a separate **coverage advisory** job that:

- executes `npm run test:coverage`,
- publishes a Markdown summary to `$GITHUB_STEP_SUMMARY`,
- uploads the generated `coverage/` report as an artifact.

### `E2E`

Runs the Playwright suite headlessly against the Docker-backed harness and uploads traces/screenshots/videos on failure.

### `Playwright Flake Detection`

This scheduled workflow runs the Playwright suite with `--repeat-each=2` on a nightly cadence plus manual dispatch. Its purpose is to catch tests that only fail intermittently before they become regular CI failures.

## Flake triage process

When a test fails non-deterministically:

1. rerun it once and confirm whether the failure is repeatable,
2. inspect the Playwright trace/video or Vitest error output,
3. file or update a tracking issue,
4. apply the `flaky-tests` label in GitHub,
5. stabilize the test quickly or quarantine it with a documented reason.

The `flaky-tests` label is a repository setting, not a versioned file. If it is missing in a fork, create it in GitHub before relying on the nightly workflow for triage.

## Expectations for new work

Every feature, bug fix, or refactor should add or update automated tests that cover:

1. the happy path,
2. at least one meaningful failure or edge case,
3. persistence or side effects when the workflow changes stored data.

For UI work:

- add Playwright coverage when the behavior crosses page, auth, backend, realtime, or download boundaries,
- add component coverage for complex focused UI logic that should remain stable across the TypeScript/modularization refactor.

## Common review questions

Before opening a PR, answer these clearly:

- Which automated test proves the new behavior?
- Which test proves an existing workflow still works?
- If the change touches shared UI/state infrastructure, why is the chosen test layer sufficient?
- If coverage dropped for a critical path, is that intentional and explained?
