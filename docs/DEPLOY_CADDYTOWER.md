# Deploying CuraFlow with Docker and CaddyTower

This runbook covers the new single-image Docker path for CuraFlow, the local demo stack, and the recommended CaddyTower setup for VPS deployment.

## What gets deployed

CuraFlow now ships with a root `Dockerfile` that builds:

- the Vite frontend,
- the Express backend,
- a single runtime container on port `3000`.

The container can optionally run a rolling demo seed at startup when:

- `CURAFLOW_INSTANCE_KIND=demo`
- `CURAFLOW_DEMO_SEED=1`

## Local demo

1. Copy the example file:

   ```bash
   cp .env.demo.example .env.demo
   ```

2. Fill in the placeholder secrets and passwords in `.env.demo`.

3. Start the demo:

   ```bash
   docker compose --env-file .env.demo -f docker-compose.demo.yml up --build
   ```

4. Open `http://localhost:3000`.

The demo seed resets only `demo-` prefixed records each time the app container starts in demo mode and refuses to overwrite non-demo rows if a unique-key collision is detected.

## Demo users

The rolling demo seed creates at least these logins:

- `demo-admin@curaflow.local`
- `demo-user@curaflow.local`
- `demo-readonly@curaflow.local`
- `demo-reset@curaflow.local` (forced password change)

Passwords come from:

- `CURAFLOW_DEMO_ADMIN_PASSWORD`
- `CURAFLOW_DEMO_USER_PASSWORD`
- `CURAFLOW_DEMO_READONLY_PASSWORD`
- `CURAFLOW_DEMO_RESET_PASSWORD`

All demo passwords must be at least 12 characters long.

## CI / GHCR flow

The `Docker Demo` workflow:

1. builds the root Docker image,
2. starts `docker-compose.demo.yml`,
3. runs `node ./scripts/run-demo-smoke.js`,
4. on `master`, publishes `ghcr.io/<owner>/curaflow:latest`,
5. optionally notifies a CaddyTower deploy webhook if the webhook secrets are present.

## CaddyTower project setup

### Recommended project type

Create a **web** project in CaddyTower.

Use:

- **Image ref:** `ghcr.io/<owner>/curaflow:latest`
- **Internal port:** `3000`
- **Health check path:** `/health`
- **Health timeout:** `10`

### Database attachments

Attach **two MariaDB databases**:

1. master DB for `app_users`, `db_tokens`, and master-side metadata
2. tenant DB for the actual CuraFlow tenant data

Recommended env var names in CaddyTower:

- master DB attachment: `CURAFLOW_MASTER_MYSQL_URL`
- tenant DB attachment: `CURAFLOW_TENANT_MYSQL_URL`

The runtime server reads the master DB config. The demo seed reads both master and tenant DB configs so it can refresh the demo tenant token row in the master DB and then seed the tenant DB itself.

### Required app env vars

Set at least:

```dotenv
NODE_ENV=production
PORT=3000
JWT_SECRET=<secure-random-value>
APP_URL=https://<your-curaflow-domain>
PUBLIC_APP_URL=https://<your-curaflow-domain>
FRONTEND_URL=https://<your-curaflow-domain>
ALLOWED_ORIGINS=https://<your-curaflow-domain>

CURAFLOW_INSTANCE_KIND=demo
CURAFLOW_DEMO_SEED=1
CURAFLOW_DEMO_TENANT_ID=demo-tenant-main
CURAFLOW_DEMO_TENANT_NAME=CuraFlow Demo Tenant
CURAFLOW_DEMO_ADMIN_PASSWORD=<set>
CURAFLOW_DEMO_USER_PASSWORD=<set>
CURAFLOW_DEMO_READONLY_PASSWORD=<set>
CURAFLOW_DEMO_RESET_PASSWORD=<set>
```

### Recommended domain

Use the generated CaddyTower subdomain or attach a custom hostname. CuraFlow serves both the API and frontend from the same container, so no extra path routing is required for the standard deployment.

## Automatic deployment from GitHub

The workflow can notify CaddyTower after a successful GHCR push. Add these repository secrets:

- `CADDYTOWER_DEPLOY_WEBHOOK_URL`
- `CADDYTOWER_DEPLOY_WEBHOOK_SECRET`

The webhook URL is the project-specific CaddyTower deploy endpoint, for example:

```text
https://caddytower.example.com/api/webhooks/deploy/curaflow
```

If you prefer importing the repo directly in CaddyTower, the new root `Dockerfile` and GHCR workflow are compatible with that flow too.

## VPS validation checklist

After the first deploy:

1. open `/health`
2. log in as `demo-admin@curaflow.local`
3. confirm the current week schedule is populated
4. confirm current-month wishes are visible
5. confirm training/vacation/statistics pages show seeded data
6. confirm a redeploy refreshes the `demo-` dataset
