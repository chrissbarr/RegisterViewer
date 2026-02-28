# Deployment Runbook: Register Viewer Save & Share

This document provides step-by-step instructions for deploying the Register Viewer application with the Project Save & Share feature across frontend and backend infrastructure.

## Architecture Overview

- **Frontend**: React SPA built in CI and deployed to cPanel via FTPS
- **Backend**: PHP API deployed to cPanel via FTPS
- **Data Store**: MySQL database
- **CI/CD**: GitHub Actions builds frontend, then uploads all files via FTPS

### Key Components

| Component | Technology | Deployment Target | Status Check |
|-----------|-----------|-------------------|--------------|
| Frontend | React + TypeScript | cPanel (www.registerviewer.com) | .github/workflows/deploy.yml |
| API | PHP 8.3 | cPanel (www.registerviewer.com/api) | .github/workflows/deploy.yml |
| Tests | Vitest + Playwright + PHPUnit | GitHub Actions | .github/workflows/ci.yml |
| Database | MySQL 8.0 | cPanel MySQL | N/A |

---

## Initial Setup

### Prerequisites

- GitHub account with admin access to the repository
- cPanel hosting account with PHP 8.3+, MySQL 8.0+, and FTP/FTPS access
- Node.js 22 or later installed locally
- Docker installed locally (for running API tests)

### Step 1: Create MySQL Database and Run Migrations

1. Log in to cPanel
2. Navigate to **MySQL Databases**
3. Create a new database (e.g., `register_viewer`)
4. Create a database user with a strong password
5. Add the user to the database with **All Privileges**
6. Run migration scripts to create tables:
   - Upload `api/database/migrations/001_create_projects_table.sql` and import via phpMyAdmin
   - Upload `api/database/migrations/002_create_auth_tables.sql` and import via phpMyAdmin
   - Or via command line:
     ```bash
     mysql -u <user> -p <database> < api/database/migrations/001_create_projects_table.sql
     mysql -u <user> -p <database> < api/database/migrations/002_create_auth_tables.sql
     ```

**Migrations create:**
1. `projects` table — project storage with owner tracking
2. `users` table — user accounts (email-based auth)
3. `login_codes` table — OTP login codes with rate limiting indexes
4. `revoked_tokens` table — revoked JWTs for server-side logout
5. Foreign key linking `projects.user_id` → `users.id`

### Step 2: Create Production API Config

1. Log in to cPanel → **File Manager**
2. Navigate to the API deploy path (e.g., `/subdomains/registerviewer/api/`)
3. Create `config.production.php` with your production database and auth credentials:

```php
<?php
return [
    'environment' => 'production',
    'db' => [
        'host'     => '127.0.0.1',
        'database' => 'your_database_name',
        'username' => 'your_database_user',
        'password' => 'your_database_password',
    ],
    'jwt_secret'        => 'your-secret-key-min-32-chars',
    'resend_api_key'    => 're_your_api_key_here',
    'resend_from_email' => 'noreply@your-domain.com',
];
```

**JWT Secret:** Must be at least 32 characters. Generate a 64-character random string:
```bash
openssl rand -hex 32
```

**Resend API Key:** Get from https://resend.com/ dashboard. Required for sending OTP emails.

**From Email:** Must be a domain you control and have verified in Resend. Default if omitted: `noreply@registerviewer.com`.

4. Ensure `.htaccess` is active (Apache `mod_rewrite` must be enabled)
5. This file is never overwritten by deployment — it lives only on the server

### Step 3: Configure GitHub Secrets and Variables

1. Go to repository **Settings** → **Secrets and variables** → **Actions**

#### Secrets (encrypted environment variables)

| Secret Name | Value | Source |
|-------------|-------|--------|
| `FTP_HOST` | FTP server hostname (e.g., `ftp.example.com`) | cPanel hosting provider |
| `FTP_USERNAME` | FTP username (usually same as cPanel username) | cPanel account |
| `FTP_PASSWORD` | FTP password | cPanel account |

> **Note:** Auth credentials (`JWT_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`) are **not** set as GitHub Secrets. They live in `config.production.php` on the server (see Step 2). This keeps secrets off GitHub and allows per-environment values.

### Step 4: First Deployment

1. Create a new branch and make a small change (e.g., update README)
2. Open a pull request to `master`
3. Verify CI workflow passes (both `frontend` and `api` jobs)
4. Merge to `master`
5. Automatically triggers:
   - **Deploy to cPanel**: CI passes → frontend builds in GitHub Actions → all files uploaded via FTPS

### Verification

After first deployment:

1. Visit `https://www.registerviewer.com/` and verify the SPA loads
2. Open browser DevTools and check Network tab for calls to the API URL
3. Test save functionality: create a project and share the link
4. Verify project data persists by opening the shared link in a new tab

---

## Ongoing Deployments

### Automatic Deployment on Master Push

Every push to `master` automatically:

1. Runs CI checks (.github/workflows/ci.yml):
   - Frontend: lint → unit tests → build → E2E tests
   - API: PHPUnit tests (unit + integration) via Docker

2. On CI success:
   - Frontend is built in GitHub Actions with `VITE_API_URL=https://www.registerviewer.com`
   - Built files + API source files are assembled into a deploy payload
   - Payload is uploaded to cPanel via FTPS (incremental sync)

### Manual Trigger

To manually trigger a deployment without code changes:

1. Go to repository **Actions** tab
2. Select **Deploy to cPanel** workflow → click **Run workflow** → **Run workflow**

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
- Fix types locally: `npm run build`
- Commit and push again

**Error: "E2E tests failed"**
- Check Playwright test logs in CI output
- Run locally: `npm run test:e2e`
- Fix the test failures or app bugs
- Commit and push again

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
- Run tests locally: `cd api && docker compose run --rm test bash -c "composer install -q && vendor/bin/phpunit"`

**Error: "500 Internal Server Error" on API endpoints**
- Check PHP error logs in cPanel → **Error Log**
- Verify `config.production.php` exists on the server with correct database credentials
- Ensure PHP 8.3+ is enabled and `mod_rewrite` is active
- Verify database tables exist (run migration SQL)

---

## Rollback Procedures

### Rollback (Git Revert — Recommended)

1. **Identify last good commit**:
   - Go to **Actions** → **Deploy to cPanel**
   - Find the last successful deployment
   - Note the commit hash

2. **Revert via Git**:
   ```bash
   git revert <bad-commit-hash>
   git push
   ```
   - GitHub Actions automatically rebuilds and re-deploys via FTPS
   - Creates a clean audit trail

3. **Manual Re-run**:
   - Go to Actions → Deploy to cPanel
   - Click the last successful run
   - Click **Re-run all jobs** button

### Rollback API via cPanel

- If you have backups, restore the previous version of API files via cPanel File Manager
- Database schema changes may need manual rollback

### Emergency: Disable Deployments

If automatic deployments are broken:

1. Go to **Settings** → **Branch protection rules**
2. Temporarily adjust or remove the `master` branch protection
3. Or disable workflows in **Settings** → **Actions** → **General** → **Disable all workflows**

---

## Local Development

### Frontend Development

```bash
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
docker compose run --rm test bash -c "composer install -q && vendor/bin/phpunit"

# Run unit tests only
docker compose run --rm test bash -c "composer install -q && vendor/bin/phpunit --testsuite Unit"

# Run integration tests only
docker compose run --rm test bash -c "composer install -q && vendor/bin/phpunit --testsuite Integration"

# Stop containers
docker compose down

# Stop containers and reset database
docker compose down -v
```

### Local Environment Variables

To test with a local frontend + API:

1. Start API: `cd api && docker compose up -d`
2. The `.env.development` file already sets `VITE_API_URL=http://localhost:8080`
3. Start frontend: `npm run dev`
4. Frontend will use local API for all cloud operations

---

## Configuration Reference

### GitHub Actions Secrets Required

```
FTP_HOST                 # FTP server hostname (e.g., ftp.example.com)
FTP_USERNAME             # FTP username (usually same as cPanel username)
FTP_PASSWORD             # FTP password
```

### Environment Variables in Workflows

- **VITE_API_URL**: Set to `https://www.registerviewer.com` in deploy workflow, passed to frontend build

### Key Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Frontend + API CI checks |
| `.github/workflows/deploy.yml` | Build frontend + deploy via FTPS |
| `api/config.php` | API configuration (env var fallbacks) |
| `api/docker-compose.yml` | Local dev: API + MySQL + test runner |
| `vite.config.ts` | Frontend build configuration |

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
- Check cPanel → **Error Log** for PHP errors
- Monitor MySQL usage in cPanel → **MySQL Databases**

### Health Check Endpoints

Two unauthenticated health endpoints are available for uptime monitoring:

| Endpoint | Checks | Methods |
|----------|--------|---------|
| `GET /api/health` | Database connectivity (`SELECT 1`) | GET, HEAD |
| `GET /api/health/email` | Resend API key configured + API reachable | GET, HEAD |

Both return **200** when healthy and **503** when unhealthy. HEAD requests return only status codes (no body), making them compatible with UptimeRobot free tier.

### Setting Up UptimeRobot (Free Tier)

1. Create an account at https://uptimerobot.com/
2. Add two HTTP(s) monitors:
   - **Database health:** `https://www.registerviewer.com/api/health` — checks DB connectivity
   - **Email health:** `https://www.registerviewer.com/api/health/email` — checks Resend API key validity and reachability
3. Set monitoring interval to 5 minutes
4. Configure email alerts for downtime notifications

The email health endpoint calls `GET https://api.resend.com/api-keys` with a 3-second timeout. It does not send any email — it only verifies the API key is valid and Resend is reachable.

### Email Delivery Logs

The `sendLoginCode()` function writes structured JSON to PHP's error log on every send attempt. Check cPanel → **Error Log** or grep the log file:

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
A: Yes! Run `cd api && docker compose up -d` to start a local server on `localhost:8080`. The `.env.development` file already points `VITE_API_URL` to `http://localhost:8080`.

**Q: What if deployment succeeds but the app doesn't work?**
A: Check: (1) `VITE_API_URL` is correct in GitHub variables, (2) `config.production.php` exists on the server with valid DB credentials, (3) browser console for errors.

**Q: How do I see API logs in production?**
A: Check cPanel → **Error Log** for PHP errors. You can also enable custom logging in `config.production.php`.

**Q: Can I deploy manually without pushing code?**
A: Yes! Go to **Actions** → select the Deploy workflow → **Run workflow** → **Run workflow** button.

**Q: How do I revert a broken deployment?**
A: Use `git revert` to create a new commit that undoes changes. See "Rollback Procedures" section above.

**Q: How do I run database migrations?**
A: Import the SQL files from `api/database/migrations/` via phpMyAdmin or the MySQL command line in order: `001_create_projects_table.sql`, then `002_create_auth_tables.sql`. Migrations are not run automatically during deployment.

**Q: How do I update FTP credentials?**
A: Update the `FTP_HOST`, `FTP_USERNAME`, or `FTP_PASSWORD` secrets in GitHub → Settings → Secrets and variables → Actions.

---

## Incident Scenarios

### Database Connection Issues

**Symptoms:** 500 errors from API, users unable to save/load projects.

**Response:**
1. Check cPanel → **Error Log** for PHP connection errors
2. Verify MySQL service is running in cPanel
3. Check `config.production.php` credentials match the database user
4. Test connection: log into phpMyAdmin with the same credentials
5. If the database server is down, contact your hosting provider

### Storage Abuse (Database Growth)

**Symptoms:** Slow queries, disk quota warnings from hosting provider.

**Response:**
1. Check database size in cPanel → **MySQL Databases**
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

### Owner Token Abuse (Unauthorized Project Access)

**Symptoms:** Users report projects being modified or deleted without their action.

**Response:**
1. Owner tokens are hashed (SHA-256) before storage — raw tokens never stored server-side
2. Check error logs for the affected project ID and the token hash used
3. If a specific token hash is compromised, delete all projects for that owner hash
4. The affected user will need to re-save their projects (generates new owner token)

---

## Secret Rotation

### Rotating JWT Secret (`jwt_secret`)

1. Generate a new secret: `openssl rand -hex 32`
2. Update `jwt_secret` in `config.production.php` on the server
3. All existing user sessions become invalid immediately — users must log in again
4. Verify auth flow works: request an OTP, verify it, confirm JWT is returned

**When to rotate:** Immediately if the secret is suspected to be compromised. No scheduled rotation needed otherwise (24-hour token lifetime limits exposure).

### Rotating Resend API Key (`resend_api_key`)

1. Log in to [Resend dashboard](https://resend.com/) → API Keys
2. Create a new API key
3. Update `resend_api_key` in `config.production.php` on the server
4. Verify email delivery: request an OTP and confirm the email arrives
5. Delete the old key in the Resend dashboard

**When to rotate:** Immediately if the key is exposed. Quarterly rotation recommended as a precaution.

### Verifying Config After Changes

After updating any auth config value, check the PHP error log for config warnings. The API logs a prominent `CONFIG WARNING` at startup if `jwt_secret` is missing/too short or `resend_api_key` is empty.

---

## Support & Debugging

### Common Issues Checklist

- [ ] All GitHub secrets are set: `FTP_HOST`, `FTP_USERNAME`, `FTP_PASSWORD` (run `gh secret list` to verify)
- [ ] FTP credentials work (test with FileZilla or similar FTP client)
- [ ] `config.production.php` exists on server with correct DB credentials, `jwt_secret`, and `resend_api_key`
- [ ] Database tables exist (both migration SQL files have been run)
- [ ] PHP 8.3+ is enabled on the server
- [ ] Apache `mod_rewrite` is enabled
- [ ] Node.js version matches workflow config (22) — locally
- [ ] All dependencies installed (`npm ci`)
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] Tests pass locally (`npm test`, `npm run test:e2e`)

### Getting Help

1. Check workflow logs: **Actions** tab → click run → view step details
2. Run tests locally to reproduce failures
3. Check cPanel error logs for API issues
4. Verify GitHub secrets and variables are correct
