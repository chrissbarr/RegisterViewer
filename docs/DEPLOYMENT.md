# Deployment Runbook: Register Viewer Save & Share

This document provides step-by-step instructions for deploying the Register Viewer application with the Project Save & Share feature across frontend and backend infrastructure.

## Architecture Overview

- **Frontend**: React SPA deployed to cPanel via Git Version Control
- **Backend**: PHP API deployed to cPanel via Git Version Control
- **Data Store**: MySQL database
- **CI/CD**: GitHub Actions triggers cPanel deployment via API token

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
- cPanel hosting account with PHP 8.3+, MySQL 8.0+, and Node.js
- Node.js 22 or later installed locally
- Docker installed locally (for running API tests)

### Step 1: Create MySQL Database

1. Log in to cPanel
2. Navigate to **MySQL Databases**
3. Create a new database (e.g., `register_viewer`)
4. Create a database user with a strong password
5. Add the user to the database with **All Privileges**
6. Run the migration script to create tables:
   - Upload `api/database/migrations/001_create_projects_table.sql` and import via phpMyAdmin
   - Or run via command line: `mysql -u <user> -p <database> < api/database/migrations/001_create_projects_table.sql`

### Step 2: Set Up cPanel Git Version Control

1. Log in to cPanel
2. Navigate to **Files** → **Git Version Control**
3. Click **Create** to clone the repository:
   - **Clone URL**: Your GitHub repository URL
   - **Repository Path**: Choose a path outside `public_html` (e.g., `/home/<user>/repositories/RegisterAppTest`)
   - **Repository Name**: `RegisterAppTest`
4. Ensure the `.cpanel.yml` file in the repo root defines the deployment tasks

### Step 3: Generate cPanel API Token

1. In cPanel, navigate to **Security** → **Manage API Tokens**
2. Click **Create** to generate a new token
3. Give it a descriptive name (e.g., `github-actions-deploy`)
4. Copy the token — it is shown only once
5. Store it securely; you will add it as a GitHub secret

### Step 4: Deploy API Files

1. The initial deployment happens via cPanel Git Version Control (pull + deploy)
2. Create `config.production.php` on the server at the API deploy path with your production database credentials:

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
];
```

3. Ensure `.htaccess` is active (Apache `mod_rewrite` must be enabled)

### Step 5: Configure GitHub Secrets and Variables

1. Go to repository **Settings** → **Secrets and variables** → **Actions**

#### Secrets (encrypted environment variables)

| Secret Name | Value | Source |
|-------------|-------|--------|
| `CPANEL_HOSTNAME` | Your cPanel URL (e.g., `https://cpanel.example.com`) | cPanel hosting provider |
| `CPANEL_USERNAME` | cPanel account username | cPanel account |
| `CPANEL_TOKEN` | API token generated in Step 3 | cPanel > Security > Manage API Tokens |

#### Variables (plaintext configuration)

| Variable Name | Value | Notes |
|---------------|-------|-------|
| `VITE_API_URL` | `/api` or `https://www.registerviewer.com/api` | API base URL used during frontend build |
| `CPANEL_REPO_PATH` | Path where repo is cloned on cPanel | e.g., `/home/<user>/repositories/RegisterAppTest` |

### Step 6: First Deployment

1. Create a new branch and make a small change (e.g., update README)
2. Open a pull request to `master`
3. Verify CI workflow passes (both `frontend` and `api` jobs)
4. Merge to `master`
5. Automatically triggers:
   - **Deploy to cPanel**: CI passes → cPanel pulls latest code → `.cpanel.yml` builds frontend and copies all files to serve paths

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
   - cPanel deployment triggers via API token
   - cPanel pulls latest code from repository
   - `.cpanel.yml` tasks execute: build frontend, copy files to serve paths

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

### API / cPanel Deployment Fails

**Error: "cPanel API connection failed"**
- Verify GitHub secrets `CPANEL_HOSTNAME`, `CPANEL_USERNAME`, and `CPANEL_TOKEN` are correct
- Ensure the API token has not been revoked in cPanel > Security > Manage API Tokens
- Check that the cPanel hostname URL is correct (include `https://`)
- Verify `CPANEL_REPO_PATH` variable matches the actual repo path on the server

**Error: "Repository not found on cPanel"**
- Ensure the repository is set up in cPanel > Files > Git Version Control
- Verify the `repository_root` path matches `CPANEL_REPO_PATH`

**Error: "Deployment tasks failed" (`.cpanel.yml`)**
- Check cPanel deployment logs for the specific task that failed
- Verify Node.js is available on the server for the frontend build step
- Ensure the `DEPLOYPATH` in `.cpanel.yml` matches the actual server directory structure

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
   - GitHub Actions automatically re-deploys via cPanel
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
CPANEL_HOSTNAME          # cPanel URL (e.g., https://cpanel.example.com)
CPANEL_USERNAME          # cPanel account username
CPANEL_TOKEN             # cPanel API token (Security > Manage API Tokens)
```

### GitHub Actions Variables Required

```
VITE_API_URL             # API base URL (e.g., /api or https://www.registerviewer.com/api)
CPANEL_REPO_PATH         # Server path where repo is cloned (e.g., /home/<user>/repositories/RegisterAppTest)
```

### Environment Variables in Workflows

- **VITE_API_URL**: Passed to frontend build, used in api-client.ts

### Key Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Frontend + API CI checks |
| `.github/workflows/deploy.yml` | Deployment to cPanel via API token |
| `.cpanel.yml` | cPanel deployment tasks (build frontend, copy files) |
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
A: Import the SQL files from `api/database/migrations/` via phpMyAdmin or the MySQL command line. Migrations are not run automatically during deployment.

**Q: How do I rotate the cPanel API token?**
A: Go to cPanel > Security > Manage API Tokens. Revoke the old token, create a new one, then update the `CPANEL_TOKEN` GitHub secret.

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

## Support & Debugging

### Common Issues Checklist

- [ ] All GitHub secrets are set (run `gh secret list` to verify)
- [ ] GitHub variables are set (run `gh variable list` to verify)
- [ ] cPanel API token is valid (not revoked)
- [ ] Repository is set up in cPanel Git Version Control
- [ ] `config.production.php` exists on server with correct DB credentials
- [ ] Database tables exist (migration SQL has been run)
- [ ] PHP 8.3+ is enabled on the server
- [ ] Node.js is available on the server (for frontend build)
- [ ] Apache `mod_rewrite` is enabled
- [ ] Node.js version matches workflow config (22)
- [ ] All dependencies installed (`npm ci`)
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] Tests pass locally (`npm test`, `npm run test:e2e`)

### Getting Help

1. Check workflow logs: **Actions** tab → click run → view step details
2. Run tests locally to reproduce failures
3. Check cPanel error logs for API issues
4. Verify GitHub secrets and variables are correct
