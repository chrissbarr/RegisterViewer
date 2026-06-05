# Deployment Runbook: Register Viewer Save & Share

This document provides step-by-step instructions for deploying the Register Viewer application with the Project Save & Share feature across frontend and backend infrastructure.

## Architecture Overview

- **Frontend**: React SPA built in CI, packaged into a deploy artifact, and deployed to cPanel via FTPS
- **Backend**: PHP API packaged in CI with production Composer dependencies and deployed to cPanel via FTPS
- **Data Store**: MySQL database
- **CI/CD**: CI is the only producer of files intentionally uploaded by the deploy workflow; deploy only downloads, verifies, uploads, and smoke-tests the CI artifact. Deploy may check out workflow helper scripts, but never rebuilds or uploads repository source files.

### Key Components

| Component | Technology | Deployment Target | Status Check |
|-----------|-----------|-------------------|--------------|
| Frontend | React + TypeScript | cPanel (www.registerviewer.com) | `.github/workflows/ci.yml` job `frontend` |
| API | PHP 8.3 compatibility floor | cPanel (www.registerviewer.com/api) | `.github/workflows/ci.yml` jobs `api` and `deploy-payload` |
| Tests | Vitest + Playwright + PHPUnit | GitHub Actions | `.github/workflows/ci.yml` jobs `frontend`, `e2e`, and `api` |
| Database | MySQL 8.0 | cPanel MySQL | N/A |

---

## Initial Setup

### Prerequisites

- GitHub account with admin access to the repository
- cPanel hosting account with PHP 8.3+, MySQL 8.0+, FTP/FTPS access, and PHP extensions `curl`, `json`, `mbstring`, `pdo`, and `pdo_mysql`
- Node.js 22 or later installed locally
- Docker installed locally (for running API tests)

Production requires PHP 8.3 or newer. CI validates API compatibility on PHP 8.3, the minimum supported production runtime.

### Step 1: Create MySQL Database

1. Log in to cPanel
2. Navigate to **MySQL Databases**
3. Create a new database (e.g., `register_viewer`)
4. Create a database user with a strong password
5. Add the user to the database with **All Privileges**
6. Do not import individual migration files during normal setup. The deployed PHP API runs all numbered migrations from `api/database/migrations/` as a hard pre-routing readiness step.

**Migrations create:**
1. `projects` table - project storage with owner tracking
2. `users` table - user accounts (email-based auth)
3. `login_codes` table - OTP login challenges and per-code lockout state
4. `auth_rate_limits` table - fixed-window auth rate-limit buckets
5. `revoked_tokens` table - revoked JWTs for server-side logout
6. `_migrations` table - applied migration tracking
7. Foreign key linking `projects.user_id` -> `users.id`

The API returns `503 schema_not_ready` with `Retry-After: 5` instead of routing requests if it cannot apply every numbered migration or prove the required schema shape, including `projects.version`, `login_codes.code_verifier`, and `auth_rate_limits`. `/api/health` also returns `503 config_not_ready` if required auth secrets such as `jwt_secret` or `otp_hash_secret` are missing or too short.

The PHP runtime user must be able to create and write `api/database/.migrate.lock`. This lock file is used only to serialize migration checks and pending migration application; it is not a schema-completion sentinel. If PHP cannot open this lock file, the API returns `503 schema_not_ready` until permissions are fixed.

> **Cache note:** The API caches the schema-readiness verdict in a `database/migrations/.ready-<fingerprint>` sentinel file keyed to the migration inventory (filenames + sizes + mtimes). Any migration change invalidates it automatically. If you manually reset or restore the production database **without** deploying a migration change, delete `database/migrations/.ready-*` so the next request re-verifies the schema.

The API sets PHP and MySQL sessions to UTC. App-written `DATETIME` values and API timestamp responses are UTC; API responses use `YYYY-MM-DDTHH:mm:ssZ`. The UTC cutover migration clears transient auth tables (`login_codes`, `auth_rate_limits`, and `revoked_tokens`) while preserving durable users and projects.

### Step 2: Create Production API Config

1. Log in to cPanel -> **File Manager**
2. Navigate to the API deploy path (e.g., `/subdomains/registerviewer/api/`)
3. Create `config.production.php` with your production database, public URL/CORS settings, and auth credentials:

```php
<?php
return [
    'environment' => 'production',
    'app_url' => 'https://www.registerviewer.com',
    'allowed_origins' => [
        'https://www.registerviewer.com',
    ],
    'db' => [
        'host'     => '127.0.0.1',
        'database' => 'your_database_name',
        'username' => 'your_database_user',
        'password' => 'your_database_password',
    ],
    'jwt_secret'        => 'your-jwt-secret-min-32-chars',
    'otp_hash_secret'   => 'your-otp-hash-secret-min-32-chars',
    'resend_api_key'    => 're_your_api_key_here',
    'resend_from_email' => 'noreply@your-domain.com',
];
```

**JWT Secret:** Must be at least 32 characters. Generate a 64-character random string:
```bash
openssl rand -hex 32
```

**OTP Hash Secret:** Must be a separate random value of at least 32 characters. Generate a second 64-character random string:
```bash
openssl rand -hex 32
```

**Resend API Key:** Get from https://resend.com/ dashboard. Required for sending OTP emails.

**From Email:** Must be a domain you control and have verified in Resend. Default if omitted: `noreply@registerviewer.com`.

4. Ensure `.htaccess` is active (Apache `mod_rewrite` must be enabled)
5. `config.production.php` is never overwritten by deployment - it lives only on the server

### Step 3: Configure GitHub Secrets and Variables

1. Go to repository **Settings** -> **Secrets and variables** -> **Actions**

#### Secrets (encrypted environment variables)

| Secret Name | Value | Source |
|-------------|-------|--------|
| `FTP_HOST` | FTP server hostname (e.g., `ftp.example.com`) | cPanel hosting provider |
| `FTP_USERNAME` | FTP username (usually same as cPanel username) | cPanel account |
| `FTP_PASSWORD` | FTP password | cPanel account |

> **Note:** Server API config values (`app_url`, `allowed_origins`, `jwt_secret`, `otp_hash_secret`, `resend_api_key`, `resend_from_email`, and database credentials) are **not** GitHub Actions variables or secrets. They live in `config.production.php` on the server (see Step 2). GitHub only stores FTPS credentials and the public `VITE_API_URL` build/deploy variable.

#### Variables (plain GitHub Actions variables)

| Variable Name | Value | Source |
|---------------|-------|--------|
| `VITE_API_URL` | Production HTTPS origin, e.g. `https://www.registerviewer.com` | Public site URL |

`VITE_API_URL` is required. It must be a canonical lowercase HTTPS origin on a public DNS host: no default `:443` port, IP address, path, query string, fragment, credentials, whitespace, local/test host, or trailing slash. CI validates it before building the production frontend artifact and again before assembling the deploy payload; Deploy validates it before checksum verification, FTPS upload, and smoke tests. The PHP API does not read `VITE_API_URL`; CORS is controlled by `allowed_origins` in `config.production.php`.

### Step 4: First Deployment

1. Create a new branch and make a small change (e.g., update README)
2. Open a pull request to `master`
3. Verify pull request CI passes (`frontend`, `e2e`, and `api` jobs)
4. Merge to `master`
5. Automatically triggers:
   - **CI**: builds `frontend/dist`, installs PHP runtime dependencies, assembles `registerapptest-deploy-<sha>`, writes provenance metadata and `SHA256SUMS`
   - **Deploy to cPanel**: downloads that CI artifact, verifies metadata and checksums, uploads via FTPS, then runs smoke tests

### Verification

After first deployment:

1. Visit `https://www.registerviewer.com/` and verify the SPA loads
2. Open browser DevTools and check Network tab for calls to the API URL
3. Test email sign-in: request an OTP, verify the code, and confirm the app receives a JWT
4. Test cloud save/share: save a project while signed in, make it unlisted, and verify the shared link opens in a new tab without signing in
5. Verify private project access requires the owning signed-in account
6. Confirm deploy smoke tests passed API health. `/api/health` must report `migrations: "ready"`, no pending migrations, every numbered migration version shipped in the deploy artifact, `authConfig["jwt_secret"] === true`, `authConfig["otp_hash_secret"] === true`, `schema["projects.version"] === true`, `schema["login_codes.code_verifier"] === true`, and `schema["auth_rate_limits.scope"] === true`.
7. Confirm deploy smoke tests passed the API internal-path checks. `/api/config.php`, `/api/config.production.php`, `/api/src`, `/api/vendor`, `/api/database`, and `/api/tests` must return `403`, never `200`.

---

## Ongoing Deployments

### Automatic Deployment on Master Push

Every push to `master` automatically:

1. Runs `.github/workflows/ci.yml` validation jobs:
   - `frontend`: dependency audit, lint, knip, unit coverage, production build, and `registerapptest-frontend-dist-<sha>` upload on `master` pushes
   - `e2e`: Playwright Chromium E2E tests
   - `api`: PHP 8.3 Docker test run with Composer validation, platform checks, Composer audit, migrations, and PHPUnit
   - `deploy-payload`: downloads the frontend dist artifact, validates `VITE_API_URL`, installs PHP 8.3 runtime dependencies, checks production platform requirements, assembles `deploy/`, writes public provenance metadata, writes `SHA256SUMS`, validates required and forbidden paths, and uploads `registerapptest-deploy-<sha>`

2. Runs `.github/workflows/deploy.yml` after successful CI:
    - Downloads `registerapptest-deploy-<head_sha>` from the completed CI run
    - Verifies required files, `SHA256SUMS`, provenance SHA, provenance run ID, artifact name, and `VITE_API_URL`
    - Uploads the verified payload via FTPS and runs smoke tests against `VITE_API_URL`
    - Proves API readiness through `/api/health`, which checks DB connectivity, applied migrations, and required schema shape before normal routing is allowed

### Manual Trigger

To manually deploy an existing CI artifact without rebuilding:

1. Go to repository **Actions** tab.
2. Open a successful **CI** run from a `push` to `master`. Pull request CI, reusable `workflow_call` CI, and non-`master` runs do not produce deployable artifacts.
3. Note:
   - `ci_run_id`: the numeric run ID from the run URL
   - `expected_sha`: the full 40-character commit SHA for that run
4. Select **Deploy to cPanel** workflow on the `master` branch, click **Run workflow**, and enter both inputs.
5. The deploy workflow downloads `registerapptest-deploy-<expected_sha>` from `ci_run_id` and verifies GitHub run metadata, artifact provenance, and checksums before FTPS upload.

### Monitoring Deployments

1. Go to **Actions** tab to view workflow runs
2. Click a workflow run to see step-by-step logs
3. Each step shows timing and any errors
4. Failed steps have detailed error messages for debugging

---

## Troubleshooting Deployments

### Frontend Deployment Fails

**Error: "Build failed with tsc errors"**
- Check CI logs for TypeScript compilation errors
- Fix types locally: `cd frontend && npm run build`
- Commit and push again

**Error: "E2E tests failed"**
- Check Playwright test logs in CI output
- Run locally: `cd frontend && npm run test:e2e`
- Fix the test failures or app bugs
- Commit and push again

### Deploy Payload Fails

**Error: "GitHub Actions variable VITE_API_URL is required"**
- Set `VITE_API_URL` under repository **Settings** -> **Secrets and variables** -> **Actions** -> **Variables**
- Use the canonical lowercase production HTTPS origin on a public DNS host, for example `https://www.registerviewer.com`; do not use an IP address, default `:443` port, or include `/api`, a trailing slash, query string, fragment, credentials, whitespace, or a local/test host
- Re-run CI after changing the variable so the frontend build and deploy provenance use the same value

**Error: "Missing required deploy file" or "Forbidden deploy path present"**
- Open the `deploy-payload` job in the CI run
- Confirm the `frontend` job uploaded `registerapptest-frontend-dist-<sha>`
- Confirm Composer install completed in the `api` directory with PHP 8.3 and `composer check-platform-reqs --lock --no-dev` passed
- Fix the payload assembly inputs and push a new commit

### Artifact Download or Verification Fails

**Error: "Unable to find artifact"**
- For automatic deploys, confirm the completed CI run has a `deploy-payload` job and an artifact named `registerapptest-deploy-<head_sha>`
- For manual deploys, confirm `ci_run_id` is the CI run ID, not the Deploy run ID
- Confirm `expected_sha` is the full 40-character commit SHA from that CI run
- Confirm the selected CI run is a successful `push` to `master`, not a pull request or reusable workflow run
- Check whether the artifact expired; current retention is 30 days

**Error: "metadata sha does not match" or checksum verification fails**
- Do not redeploy the downloaded files manually
- Re-run Deploy with the `ci_run_id` and `expected_sha` from the same successful CI run
- If verification still fails, re-run CI to produce a fresh `registerapptest-deploy-<sha>` artifact

### FTPS Deployment Fails

**Error: "Connection refused" or "Connection timed out"**
- Verify `FTP_HOST` secret is correct (hostname only, no protocol prefix)
- Ensure FTP/FTPS is enabled on your cPanel hosting account
- Check that port 21 is not blocked by the hosting provider

**Error: "Authentication failed"**
- Verify `FTP_USERNAME` and `FTP_PASSWORD` secrets are correct
- Test credentials by connecting via an FTP client (e.g., FileZilla) using FTPS on port 21

**Error: "Upload failed" or "Permission denied"**
- Verify the `server-dir` path in `deploy.yml` matches the actual server directory
- Ensure the FTP user has write permissions to the deploy directory

**Error: "Database connection failed" (in API tests)**
- Ensure Docker is available in the CI environment
- Check `api/docker-compose.yml` for correct MySQL configuration
- Run tests locally: `cd api && docker compose run --rm test bash -c "composer install -q && php database/migrate.php && vendor/bin/phpunit"`

**Error: "503 schema_not_ready" on API endpoints or health**
- Check PHP error logs in cPanel -> **Error Log**
- Verify `config.production.php` exists on the server with correct database credentials
- Verify the deployed `api/database/migrate.php` and all numbered files under `api/database/migrations/` are present
- Verify the PHP runtime user can create and write `api/database/.migrate.lock`
- Verify `_migrations` contains every numbered migration version in the deployed artifact, with matching filename and checksum values for the deployed files
- Check for duplicate migration version numbers, an applied `_migrations` version with no deployed SQL file, checksum or filename drift, or stale remote migration files left behind by incremental FTPS deployment
- Do not edit an already-applied migration file to fix drift. Restore the deployed migration history to match the artifact, or add a new numbered migration for schema changes.
- Verify the required schema exists, especially `projects.version`, `login_codes.code_verifier`, and `auth_rate_limits`
- If logs show the migration lock is held, wait briefly and retry `/api/health`

**Error: "500 Internal Server Error" on API endpoints**
- Check PHP error logs in cPanel -> **Error Log**
- Verify `config.production.php` exists on the server with correct database credentials
- Ensure PHP 8.3+ is enabled and `mod_rewrite` is active
- Ensure PHP extensions `curl`, `json`, `mbstring`, `pdo`, and `pdo_mysql` are enabled
- CI validates API compatibility on PHP 8.3, the minimum supported production runtime. Do not raise Docker, Composer, or dependency versions to require PHP 8.4+ unless the cPanel runtime and this deployment contract are updated together.

**Error: "Expected /api/... to be blocked with 403"**
- Confirm the deployed `api/.htaccess` file exists on the server
- Confirm Apache `.htaccess` overrides and `mod_rewrite` are enabled for the API directory
- Treat any `200` response from `/api/config.php`, `/api/src`, `/api/vendor`, `/api/database`, or `/api/tests` as a failed deployment

---

## Rollback Procedures

### Rollback to a Previous CI Artifact

Use this when the last good deploy artifact is still retained by GitHub Actions.

1. Go to **Actions** -> **CI** and find the successful run for the last good commit.
2. Confirm it was a `push` to `master` and completed `frontend`, `e2e`, `api`, and `deploy-payload` successfully.
3. Confirm the current `VITE_API_URL` variable matches the value used when the artifact was built. Deploy rejects artifacts whose `release.json` was built with a different value.
4. Note the numeric CI run ID from the URL and the full 40-character commit SHA.
5. Go to **Actions** -> **Deploy to cPanel** -> **Run workflow** on the `master` branch.
6. Enter:
   - `ci_run_id`: the CI run ID from step 4
   - `expected_sha`: the full commit SHA from step 4
7. Run the workflow. Deploy verifies GitHub run metadata, artifact provenance, and `SHA256SUMS` before uploading via FTPS.

FTPS deploys are incremental because `dangerous-clean-slate` is disabled. Redeploying an older artifact does not delete remote files that were introduced by a later deploy. If a bad deploy added or renamed files, inspect the cPanel directory and remove stale files deliberately, or prefer a git revert that produces a new artifact from the current tree.

### Rollback by Git Revert

Use this when the previous artifact has expired or the fix should become the new state of `master`.

```bash
git revert <bad-commit-hash>
git push
```

GitHub Actions will run CI, produce a new deploy artifact for the revert commit, and deploy it after CI succeeds.

### Rollback API via cPanel

- If you have backups, restore the previous version of API files via cPanel File Manager
- Database schema changes may need manual rollback

### Emergency: Disable Deployments

If automatic deployments are broken:

1. Go to **Settings** -> **Branch protection rules**
2. Temporarily adjust or remove the `master` branch protection
3. Or disable workflows in **Settings** -> **Actions** -> **General** -> **Disable all workflows**

---

## Local Development

### Frontend Development

```bash
cd frontend

# Start dev server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run tests
npm test
npm run test:watch
npm run test:e2e
```

### API Development

```bash
cd api

# Start local API + MySQL (runs on localhost:8080)
docker compose up -d

# Run all tests
docker compose run --rm test bash -c "composer install -q && php database/migrate.php && vendor/bin/phpunit"

# Run unit tests only
docker compose run --rm test bash -c "composer install -q && php database/migrate.php && vendor/bin/phpunit --testsuite Unit"

# Run integration tests only
docker compose run --rm test bash -c "composer install -q && php database/migrate.php && vendor/bin/phpunit --testsuite Integration"

# Stop containers
docker compose down

# Stop containers and reset database
docker compose down -v
```

### Local Environment Variables

To test with a local frontend + API:

1. Start API: `cd api && docker compose up -d`
2. The `frontend/.env.development` file already sets `VITE_API_URL=http://localhost:8080`
3. Start frontend: `cd frontend && npm run dev`
4. Frontend will use local API for all cloud operations

The strict HTTPS-origin `VITE_API_URL` rule applies to GitHub Actions production CI/deploy. Local development may use `http://localhost:8080`.

---

## Configuration Reference

### GitHub Actions Secrets Required

```
FTP_HOST                 # FTP server hostname (e.g., ftp.example.com)
FTP_USERNAME             # FTP username (usually same as cPanel username)
FTP_PASSWORD             # FTP password
```

### GitHub Actions Variables Required

- **VITE_API_URL**: Canonical lowercase public production HTTPS origin on a DNS host, for example `https://www.registerviewer.com`. Do not use an IP address, default `:443` port, or include `/api`, a trailing slash, query string, fragment, credentials, whitespace, or a local/test host. CI uses it for the frontend production build and deploy provenance. Deploy validates it before verification, FTPS upload, and smoke tests. It does not configure the PHP API server.

### Key Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Frontend, E2E, API, and `deploy-payload` jobs; produces deploy artifacts for successful `master` push runs |
| `.github/workflows/deploy.yml` | Downloads and verifies CI deploy artifacts, uploads via FTPS, and runs smoke tests |
| `api/config.php` | API configuration (env var fallbacks) |
| `api/docker-compose.yml` | Local dev: API + MySQL + test runner |
| `frontend/vite.config.ts` | Frontend build configuration |

---

## Monitoring and Observability

### GitHub Actions Logs

1. Go to **Actions** tab
2. Click a workflow run to view detailed logs
3. Expand individual steps to see command output
4. Search logs for "error" or "Error"

### Frontend Availability

- Visit https://www.registerviewer.com/
- Check browser console for errors
- Expected response time: <1s

### API Health

- Test the API endpoint directly: `curl https://www.registerviewer.com/api/projects` (should return 401)
- Check cPanel -> **Error Log** for PHP errors
- Monitor MySQL usage in cPanel -> **MySQL Databases**

### Health Check Endpoints

Two unauthenticated health endpoints are available for uptime monitoring:

| Endpoint | Checks | Methods |
|----------|--------|---------|
| `GET /api/health` | Database connectivity, required auth secrets, all numbered migrations applied, and required schema shape including `projects.version`, `login_codes.code_verifier`, and auth rate-limit schema | GET, HEAD |
| `GET /api/health/email` | Resend API key configured + API reachable | GET, HEAD |

Both return **200** when healthy and **503** when unhealthy. HEAD requests return only status codes (no body), making them compatible with UptimeRobot free tier.
Normal API routes use the same migration/schema readiness gate. If readiness cannot be established, they return `503` before route handling.

### Setting Up UptimeRobot (Free Tier)

1. Create an account at https://uptimerobot.com/
2. Add two HTTP(s) monitors:
   - **API readiness:** `https://www.registerviewer.com/api/health` - checks DB connectivity plus migration/schema readiness
   - **Email health:** `https://www.registerviewer.com/api/health/email` - checks Resend API key validity and reachability
3. Set monitoring interval to 5 minutes
4. Configure email alerts for downtime notifications

The email health endpoint calls `GET https://api.resend.com/api-keys` with a 3-second timeout. It does not send any email - it only verifies the API key is valid and Resend is reachable.

### Email Delivery Logs

The `sendLoginCode()` function writes structured JSON to PHP's error log on every send attempt. Check cPanel -> **Error Log** or grep the log file:

```bash
# Successful sends
grep '"event":"email_sent"' /path/to/php-error.log

# Failed sends (with reason)
grep '"event":"email_send_failed"' /path/to/php-error.log
```

Each log entry includes:
- `event`: `email_sent` or `email_send_failed`
- `reason`: (failures only) `missing_api_key`, `network_error`, `http_4xx`/`http_5xx`, or `unknown_status`
- `duration_ms`: round-trip time to Resend API
- `timestamp`: ISO 8601 timestamp

---

## FAQ

**Q: Can I test the API locally before deploying?**
A: Yes! Run `cd api && docker compose up -d` to start a local server on `localhost:8080`. The `frontend/.env.development` file already points `VITE_API_URL` to `http://localhost:8080`.

**Q: What if deployment succeeds but the app doesn't work?**
A: Check: (1) `VITE_API_URL` is correct in GitHub variables, (2) `config.production.php` exists on the server with valid DB credentials, `app_url`, and `allowed_origins`, (3) browser console for errors.

**Q: How do I see API logs in production?**
A: Check cPanel -> **Error Log** for PHP errors. You can also enable custom logging in `config.production.php`.

**Q: Can I deploy manually without pushing code?**
A: Yes. Use **Actions** -> **Deploy to cPanel** -> **Run workflow** on the `master` branch and provide `ci_run_id` plus `expected_sha` from the successful `master` push CI run that produced `registerapptest-deploy-<sha>`.

**Q: How do I revert a broken deployment?**
A: Prefer redeploying the last good CI artifact while it is retained. Use `git revert` when the rollback should become a new commit on `master` or the artifact has expired.

**Q: How do I run database migrations?**
A: Normal deployments do not require manual SQL imports. The PHP API runs pending numbered migrations as a hard pre-routing readiness step, using `api/database/.migrate.lock` to serialize migration work. Deploy smoke proves readiness through `/api/health`. For local tests, run `php database/migrate.php` before PHPUnit if you are not using the documented Docker command.

**Q: How do I update FTP credentials?**
A: Update the `FTP_HOST`, `FTP_USERNAME`, or `FTP_PASSWORD` secrets in GitHub -> Settings -> Secrets and variables -> Actions.

---

## Incident Scenarios

### Database Connection Issues

**Symptoms:** 500 errors from API, users unable to save/load projects.

**Response:**
1. Check cPanel -> **Error Log** for PHP connection errors
2. Verify MySQL service is running in cPanel
3. Check `config.production.php` credentials match the database user
4. Test connection: log into phpMyAdmin with the same credentials
5. If the database server is down, contact your hosting provider

### Storage Abuse (Database Growth)

**Symptoms:** Slow queries, disk quota warnings from hosting provider.

**Response:**
1. Check database size in cPanel -> **MySQL Databases**
2. Identify large or suspicious projects via phpMyAdmin
3. Delete offending rows from the `projects` table
4. Consider adding rate limiting at the Apache/cPanel level
5. Monitor database size growth over time

### Data Corruption (Invalid Project Data)

**Symptoms:** Users see blank projects, JSON parse errors, 500 errors on GET.

**Response:**
1. Check cPanel error log for details on the affected project
2. Query the corrupted row: `SELECT * FROM projects WHERE id = '<id>'`
3. If recoverable, fix the data and update the row
4. If unrecoverable, delete the row
5. Check for root cause: deployment bug, concurrent writes, or malicious input

### Account Session Compromise (Unauthorized Project Access)

**Symptoms:** Users report projects being modified or deleted without their action.

**Response:**
1. Identify the affected project by `public_id` and confirm its owning `user_id`/email in the database
2. Check access logs, PHP error logs, and recent updates for the affected account and project IDs
3. If an active session may be compromised, rotate `jwt_secret` to invalidate all outstanding JWTs
4. Restore or remove modified project rows as appropriate, then have the user sign in again with email OTP
5. If the email account itself is compromised, ask the user to secure that email account before relying on cloud project ownership

---

## Secret Rotation

### Rotating JWT Secret (`jwt_secret`)

1. Generate a new secret: `openssl rand -hex 32`
2. Update `jwt_secret` in `config.production.php` on the server
3. All existing user sessions become invalid immediately - users must log in again
4. Verify auth flow works: request an OTP, verify it, confirm JWT is returned

**When to rotate:** Immediately if the secret is suspected to be compromised. No scheduled rotation needed otherwise (24-hour token lifetime limits exposure).

### Rotating OTP Hash Secret (`otp_hash_secret`)

1. Generate a new secret: `openssl rand -hex 32`
2. Update `otp_hash_secret` in `config.production.php` on the server
3. Outstanding email OTPs become invalid immediately; users can request a new code
4. Verify auth flow works: request an OTP, verify it, confirm JWT is returned

**When to rotate:** Immediately if the secret is suspected to be compromised. No scheduled rotation needed otherwise because OTPs expire after 10 minutes.

### Rotating Resend API Key (`resend_api_key`)

1. Log in to [Resend dashboard](https://resend.com/) -> API Keys
2. Create a new API key
3. Update `resend_api_key` in `config.production.php` on the server
4. Verify email delivery: request an OTP and confirm the email arrives
5. Delete the old key in the Resend dashboard

**When to rotate:** Immediately if the key is exposed. Quarterly rotation recommended as a precaution.

### Verifying Config After Changes

After updating any auth config value, check the PHP error log for config warnings. The API logs a prominent `CONFIG WARNING` at startup if `jwt_secret` or `otp_hash_secret` is missing/too short, or if `resend_api_key` is empty.

---

## Support & Debugging

### Common Issues Checklist

- [ ] All GitHub secrets are set: `FTP_HOST`, `FTP_USERNAME`, `FTP_PASSWORD` (run `gh secret list` to verify)
- [ ] GitHub Actions variable `VITE_API_URL` is set to the canonical lowercase production HTTPS origin on a public DNS host with no `/api` path or trailing slash
- [ ] No GitHub Actions `ALLOWED_ORIGINS` variable is expected; CORS origins live in `config.production.php`
- [ ] FTP credentials work (test with FileZilla or similar FTP client)
- [ ] The CI run has successful `frontend`, `e2e`, `api`, and `deploy-payload` jobs
- [ ] The CI run was triggered by a `push` to `master`
- [ ] The CI run uploaded `registerapptest-deploy-<sha>` and the Deploy run is using the same SHA
- [ ] `config.production.php` exists on server with correct DB credentials, `app_url`, `allowed_origins`, `jwt_secret`, `otp_hash_secret`, and `resend_api_key`
- [ ] `/api/health` returns ready and confirms all numbered migrations plus `projects.version`, `login_codes.code_verifier`, and `auth_rate_limits`
- [ ] PHP 8.3+ is enabled on the server
- [ ] PHP extensions `curl`, `json`, `mbstring`, `pdo`, and `pdo_mysql` are enabled on the server
- [ ] Apache `mod_rewrite` is enabled
- [ ] Node.js version matches workflow config (22) locally
- [ ] All frontend dependencies installed (`cd frontend && npm ci`)
- [ ] TypeScript compiles without errors (`cd frontend && npm run build`)
- [ ] Frontend tests pass locally (`cd frontend && npm test`, `cd frontend && npm run test:e2e`)

### Getting Help

1. Check workflow logs: **Actions** tab -> click run -> view step details
2. Run tests locally to reproduce failures
3. Check cPanel error logs for API issues
4. Verify GitHub secrets and variables are correct
