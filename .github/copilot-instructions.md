# AI Coding Instructions — CuraFlow

> These instructions apply to all AI assistants (GitHub Copilot, Claude, Cursor, Windsurf, or any other LLM-based code generation tool) working on this codebase. When generating, reviewing, or refactoring code in CuraFlow, follow these rules without exception.

CuraFlow is a production web application for hospital shift scheduling and staff management. It handles sensitive healthcare personnel data and runs in clinical environments. The codebase consists of a **React/Vite frontend** and a **Node.js/Express backend** with MySQL.

**The lingua franca for all code (identifiers, comments, commit messages, documentation) is English.**

---

## Project Structure

```
src/              → React frontend (JSX, Vite, TanStack Query, Radix UI, Tailwind CSS)
server/           → Express backend (REST API, JWT auth, mysql2)
server/routes/    → Route handlers (auth, schedule, staff, admin, etc.)
server/utils/     → Shared utilities (crypto, email, realtime, migrations)
server/migrations/→ SQL migration files
docs/             → Architecture and feature documentation
```

---

## Code Quality Standards

### General Principles

- Write **production-ready code** — no placeholder logic, no `TODO` left without a tracking issue reference, no `console.log` debugging statements in committed code.
- Prefer **small, focused functions** (≤ 40 lines). Extract complex logic into well-named helper functions.
- Follow the **Single Responsibility Principle** — each module, component, and function does one thing well.
- Use **descriptive names** — variable and function names should reveal intent without needing a comment.
- Avoid premature abstraction — do not introduce patterns (factories, wrappers, middleware) until there is a proven need.
- Every file should have a **single clear purpose**. If a file grows beyond ~300 lines, consider splitting it.

### JavaScript / Node.js

- Use **ES Modules** (`import`/`export`) everywhere — this project uses `"type": "module"`.
- Prefer `const` over `let`; never use `var`.
- Use **async/await** for asynchronous operations — never raw `.then()` chains.
- Handle errors explicitly: always `try/catch` around async operations at API boundaries. Never swallow errors silently.
- Use **early returns** to reduce nesting.
- Validate function inputs at the boundary — use Zod schemas for request validation in API routes.
- Avoid mutating function arguments. Return new values instead.

### React / Frontend

- Use **functional components** exclusively with hooks.
- Keep components focused: split UI rendering from business logic using custom hooks (`use*` prefix).
- Co-locate component-specific logic: a component's hook, utilities, and tests live near the component.
- Use the `@/` path alias for imports from `src/`.
- Memoize expensive computations with `useMemo` and callbacks with `useCallback` — but only when there is a measured performance need.
- Never store derived state — compute it from source state.
- Use TanStack Query for all server state. Keep query keys consistent and well-structured.
- Use Radix UI primitives and the existing `src/components/ui/` component library. Do not introduce new UI frameworks.

### Backend / Express

- All route handlers must be `async` and wrap logic in try/catch, returning appropriate HTTP status codes.
- Use parameterized queries (`?` placeholders) for **all** SQL — never concatenate user input into SQL strings.
- Validate request body, params, and query strings before processing.
- Keep route files thin — extract business logic into service functions or utilities.
- Return consistent JSON response shapes: `{ data }` for success, `{ error: "message" }` for failures.
- Use appropriate HTTP methods and status codes (201 for created, 204 for no content, 400 for bad input, 401 for unauthenticated, 403 for unauthorized, 404 for not found, 409 for conflicts, 422 for validation errors, 429 for rate-limited).

---

## Testing (Mandatory for New Code)

Every new feature, bug fix, or refactoring must include corresponding tests. Untested code is incomplete code.

### Test Framework and Tools

| Layer | Tool | Location |
|-------|------|----------|
| Unit (frontend) | Vitest + React Testing Library | `src/**/__tests__/` |
| Unit (backend) | Vitest + Supertest | `server/__tests__/` |
| Integration | Vitest + Supertest | `server/__tests__/integration/` |
| E2E | Playwright | `e2e/` |

### Test Requirements

- **Unit tests** for every utility function, custom hook, and service module.
- **Integration tests** for every API endpoint — test the happy path, error cases, authentication, and authorization.
- **Component tests** for complex interactive components (schedule board, drag-and-drop, forms).
- Tests must be **deterministic** — no reliance on system time (use dependency injection or mocks), no random values without seeds.
- Test **edge cases**: empty arrays, null values, boundary dates, maximum lengths, concurrent operations.
- Assert **specific error types and messages** — not just `expect(result).toBeFalsy()`.
- Mock external dependencies (database, APIs, email) in unit tests. Use real connections only in integration tests with proper setup/teardown.
- Achieve **≥80% code coverage** for new code. Critical paths (auth, scheduling logic, cost function) must have ≥95% coverage.

### Test Hygiene

- Test names describe the scenario: `it('returns 401 when JWT token is expired')`.
- Each test is independent — no shared mutable state between tests.
- Use `beforeEach`/`afterEach` for setup and teardown, not test-order dependencies.
- Clean up any created database records or files after tests complete.

---

## Security (Non-Negotiable)

This application runs in hospital environments. Security failures can have regulatory and legal consequences.

### PHI and Sensitive Data Protection

- **Never log patient or staff personal data** (names, IDs, dates of birth, email addresses). Use opaque identifiers (database IDs, UIDs) in log output.
- **Never include PHI in error messages** returned to the client.
- **Never commit credentials, secrets, or API keys** to version control. All secrets must come from environment variables.
- **Never hardcode passwords** (including demo/test/seed passwords) in source files, scripts, fixtures, Docker/compose files, tests, or docs. Use required environment variables instead.
- **Sanitize all user-facing output** to prevent XSS. React handles this by default — never use `dangerouslySetInnerHTML` without explicit sanitization.
- **Never expose internal system details** (stack traces, SQL errors, file paths) in API responses outside of development mode.

### Authentication and Authorization

- Every API endpoint (except public auth routes) must verify the JWT token via `authMiddleware`.
- Check authorization (user role and tenant scope) for every operation — never trust the client.
- Use `bcryptjs` with a cost factor ≥10 for password hashing.
- JWT tokens must have a reasonable expiration time. Never issue non-expiring tokens.
- Rate-limit authentication endpoints to prevent brute-force attacks.

### Input Validation and Injection Prevention

- **Parameterize all SQL queries** — this is the single most critical security rule.
- Validate and sanitize all input at the API boundary: type-check, length-limit, and whitelist expected values.
- Reject unexpected fields in request bodies — do not blindly spread `req.body` into database operations.
- Validate file uploads: check MIME type, enforce size limits, and sanitize filenames.
- Encode output contextually (HTML, URL, SQL) — never trust that upstream already did it.

### Dependency Security

- Do not add new dependencies without justification. Prefer well-maintained packages with small attack surfaces.
- Before adding a dependency, verify: active maintenance, no known critical CVEs, reasonable download count, MIT/Apache-2.0 license.
- Never use `eval()`, `Function()`, or dynamic `require()`/`import()` with user-controlled input.

---

## Modularity and Maintainability

### File Organization

- Group by feature, not by type. Example: schedule-related components, hooks, utils, and tests live under `src/components/schedule/` or `src/pages/Schedule/`.
- Shared utilities go in `src/utils/` (frontend) or `server/utils/` (backend).
- Shared UI components go in `src/components/ui/`.
- Keep the dependency graph acyclic — lower-level modules must not import from higher-level modules.

### API Design

- RESTful endpoints with consistent naming: `/api/{resource}` (plural nouns).
- Use query parameters for filtering and pagination, not request bodies on GET.
- Version-breaking changes should be avoided; prefer additive changes.
- Document new endpoints with request/response examples in `docs/API.md`.

### Database

- All schema changes require a numbered migration file in `server/migrations/`.
- Migrations must be **idempotent** — safe to run multiple times (use `IF NOT EXISTS`, `IF EXISTS`).
- Use transactions for operations that modify multiple tables.
- Add indexes for columns used in WHERE clauses and JOINs.
- Never modify or delete existing migration files — only add new ones.

### State Management

- Server state lives in TanStack Query — never duplicate API data in local React state.
- Client-only state (UI toggles, form inputs, modal open/close) uses `useState` or `useReducer`.
- Global cross-cutting state (auth, theme, tenant) uses React Context via providers in `src/contexts/`.
- Avoid prop drilling beyond 2 levels — use Context or composition patterns.

---

## Error Handling

- **Frontend**: Show user-friendly error messages via toast notifications. Log technical details to the console only in development mode.
- **Backend**: Catch errors at the route handler level. Return structured error responses with appropriate status codes. Log errors with structured context (request ID, user ID, endpoint) using `console.error` with JSON metadata — never log raw stack traces in production.
- **Never fail silently** — if an operation can fail, handle the failure explicitly and communicate it to the caller.
- Use **custom error classes** for domain-specific errors to enable precise error handling upstream.

---

## Performance

- Avoid N+1 queries — use JOINs or batch fetches for related data.
- Paginate all list endpoints that could return unbounded results.
- Use database connection pooling (already configured via mysql2 pools) — never open individual connections per request.
- Debounce frequent user-triggered operations (search, auto-save, resize).
- Lazy-load route components with `React.lazy()` and `Suspense` for code splitting.

---

## Git and Workflow

- Write **atomic commits** — each commit represents one logical change that passes linting and tests.
- Commit messages follow Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- Before considering work complete, verify:
  - `npm run lint` passes (in project root)
  - `npm run build` succeeds
  - All new and existing tests pass
  - No TypeScript/JSDoc type errors (`npm run typecheck`)

---

## CI Readiness

Before handing off any change, verify locally:

```bash
# Frontend
npm run lint          # ESLint must pass with zero errors
npm run build         # Vite production build must succeed
npm run typecheck     # Type checking must pass

# Backend (from server/ directory)
node --check index.js # Syntax check
```

If any step fails, fix the issue before considering the task complete.

---

## What NOT to Do

- ❌ Do not store application state in global variables or module-level singletons (except connection pools).
- ❌ Do not disable ESLint rules without a comment explaining the specific reason.
- ❌ Do not use `any`-style loose patterns — even in JavaScript, use JSDoc type annotations for public APIs.
- ❌ Do not generate German-language code (identifiers, comments). All code is in English. German is acceptable only in user-facing UI strings and documentation targeted at end users.
