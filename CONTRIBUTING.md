# Contributing to CuraFlow

Use this file as the short handoff for day-to-day contribution rules. Detailed setup and architecture notes live under `docs/`.

## Start here

- Setup: [`docs/SETUP.md`](docs/SETUP.md)
- Testing: [`docs/TESTING.md`](docs/TESTING.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Required standards

- Use **English** for code, identifiers, comments, commit messages, and developer-facing docs.
- Keep changes focused and production-safe.
- Do not commit secrets, seeded passwords, or test credentials.
- Prefer extending existing helpers, fixtures, and page objects over duplicating logic.

## Test expectations

Every feature, bug fix, and refactor needs automated coverage appropriate to the change.

Minimum expectation per PR:

1. cover the happy path,
2. cover at least one error case or edge case,
3. prove persistence or side effects when data is mutated.

Typical mapping:

- **Unit test**: pure utilities, helpers, business rules
- **Component test**: focused UI logic with mocked API boundaries
- **Playwright**: full workflows, auth, backend persistence, downloads, realtime, cross-page behavior

## Local validation before opening a PR

Run the commands that match your change scope.

Always run:

```bash
npm run build
npm run test:unit
npm run test:component
```

Also run for UI workflow changes:

```bash
npm run test:e2e
```

Also run when checking coverage-sensitive changes:

```bash
npm run test:coverage
```

## Selector and test conventions

- Prefer `getByRole` and `getByLabel` over `data-testid`.
- Add `data-testid` only when there is no stable semantic hook.
- Keep Playwright locators inside page objects under `e2e/pages/`.
- Keep mutating E2E tests deterministic and clean up created records.

## Coverage policy

- New or meaningfully changed code should target **>= 80% line coverage**
- Critical paths should target **>= 95% line coverage**

Coverage is currently surfaced as a **non-blocking CI advisory**, so reviewers must still judge whether the changed files are covered well enough.

## Flake handling

If a test is non-deterministic:

1. inspect the failing trace/logs,
2. file or update a tracking issue,
3. apply the `flaky-tests` label in GitHub,
4. fix or quarantine it quickly with a documented reason.

Nightly flake detection runs the Playwright suite with `--repeat-each=2` to catch intermittent failures earlier.
