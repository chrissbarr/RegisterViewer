# Deployment Runbook: Register Viewer Save & Share

This document provides step-by-step instructions for deploying the Register Viewer application with the Project Save & Share feature across frontend and backend infrastructure.

## Architecture Overview

- **Frontend**: React SPA deployed to GitHub Pages (chrissbarr.github.io)
- **Backend**: Cloudflare Worker deployed to Cloudflare Workers platform
- **Data Store**: Cloudflare KV (key-value storage)
- **CI/CD**: GitHub Actions workflows

### Key Components

| Component | Technology | Deployment Target | Status Check |
|-----------|-----------|-------------------|--------------|
| Frontend | React + TypeScript | GitHub Pages | .github/workflows/deploy.yml |
| Worker API | TypeScript | Cloudflare Workers | .github/workflows/deploy-worker.yml |
| Tests | Vitest + Playwright | GitHub Actions | .github/workflows/ci.yml |
| KV Store | Cloudflare KV | N/A (provisioned with worker) | N/A |

---

## Initial Setup

### Prerequisites

- GitHub account with admin access to the repository
- Cloudflare account with billing enabled
- Node.js 22 or later installed locally
- `wrangler` CLI installed globally (`npm install -g wrangler@latest`)

### Step 1: Create Cloudflare KV Namespaces

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** → **KV**
3. Create two KV namespaces:
   - **Production namespace** (e.g., `registerviewer-projects`)
   - **Preview namespace** (e.g., `registerviewer-projects-preview`)

4. Note down both namespace IDs (they look like: `abcd1234efgh5678ijkl9012mnop3456`)

### Step 2: Update Worker Configuration

1. Open `worker/wrangler.toml`
2. Replace placeholder IDs with actual namespace IDs:

```toml
[[kv_namespaces]]
binding = "PROJECTS"
id = "YOUR_PRODUCTION_NAMESPACE_ID"
preview_id = "YOUR_PREVIEW_NAMESPACE_ID"
```

3. Save the file

### Step 3: Configure GitHub Secrets and Variables

1. Go to repository **Settings** → **Secrets and variables** → **Actions**

#### Secrets (encrypted environment variables)

Create these secrets:

| Secret Name | Value | Source |
|-------------|-------|--------|
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (find at dash.cloudflare.com or `wrangler whoami`) | Cloudflare Dashboard |
| `CLOUDFLARE_API_TOKEN` | API token with Workers AI permissions | See Step 3a below |

**Step 3a: Create Cloudflare API Token**

1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token** → Use template **Edit Cloudflare Workers**
3. Copy the token
4. Create a GitHub secret named `CLOUDFLARE_API_TOKEN` with this value

#### Variables (plaintext configuration)

Create this variable:

| Variable Name | Value | Notes |
|---------------|-------|-------|
| `VITE_API_URL` | `https://register-viewer-api.workers.dev` | Update domain if you use a custom domain |

### Step 4: Verify GitHub Pages Configuration

1. Go to repository **Settings** → **Pages**
2. Ensure **Build and deployment** is set to:
   - **Source**: GitHub Actions
   - (The deploy workflow will handle the deployment)

### Step 5: First Deployment

1. Create a new branch and make a small change (e.g., update README)
2. Open a pull request to `master`
3. Verify CI workflow passes (run: `frontend` job and `worker` job)
4. Merge to `master`
5. Automatically triggers:
   - **GitHub Pages Deploy**: Frontend builds and deploys to GitHub Pages
   - **Worker Deploy**: Backend deploys to Cloudflare Workers

### Verification

After first deployment:

1. Visit `https://chrissbarr.github.io/register-viewer/` and verify the SPA loads
2. Open browser DevTools and check Network tab for calls to `https://register-viewer-api.workers.dev/api/*`
3. Test save functionality: create a project and share the link
4. Verify project data persists by opening the shared link in a new tab

---

## Ongoing Deployments

### Automatic Deployment on Master Push

Every push to `master` automatically:

1. Runs CI checks (.github/workflows/ci.yml):
   - Frontend: lint → unit tests → build → E2E tests
   - Worker: install → unit tests

2. On CI success:
   - GitHub Pages Deploy job: builds frontend and deploys to GitHub Pages
   - Worker Deploy job: deploys updated worker code to Cloudflare

### Manual Trigger

To manually trigger a deployment without code changes:

1. Go to repository **Actions** tab
2. Select either:
   - **Deploy to GitHub Pages** workflow → click **Run workflow** → **Run workflow**
   - **Deploy Worker** workflow → click **Run workflow** → **Run workflow**

### Monitoring Deployments

1. Go to **Actions** tab to view workflow runs
2. Click a workflow run to see step-by-step logs
3. Each step shows timing and any errors
4. Failed steps have detailed error messages for debugging

---

## Troubleshooting Deployments

### Frontend Deployment Fails

**Error: "GitHub Pages Environment Not Found"**
- Fix: Go to **Settings** → **Pages** and ensure source is set to "GitHub Actions"

**Error: "Build failed with tsc errors"**
- Check CI logs for TypeScript compilation errors
- Fix types locally: `npm run build`
- Commit and push again

**Error: "E2E tests failed"**
- Check Playwright test logs in CI output
- Run locally: `npm run test:e2e`
- Fix the test failures or app bugs
- Commit and push again

### Worker Deployment Fails

**Error: "Invalid API token"**
- Verify GitHub secret `CLOUDFLARE_API_TOKEN` is correct
- Regenerate token if needed at [API Tokens](https://dash.cloudflare.com/profile/api-tokens)
- Update the GitHub secret with new token

**Error: "KV namespace not found"**
- Verify namespace IDs in `worker/wrangler.toml` match your Cloudflare account
- Check that both production and preview namespaces exist
- Update wrangler.toml with correct IDs

**Error: "Wrangler command not found"**
- Ensure worker/package.json includes `"wrangler"` in devDependencies
- Run `npm install` in worker directory to fetch dependency

### API URL Not Set in Frontend

**Symptom: API calls fail with undefined URL**
- Verify `vars.VITE_API_URL` is set in repository variables
- Rebuild frontend: manually trigger **Deploy to GitHub Pages** workflow
- Check that build step receives the environment variable

---

## Rollback Procedures

### Rollback Frontend (GitHub Pages)

1. **Identify last good commit**:
   - Go to **Actions** → **Deploy to GitHub Pages**
   - Find the last successful deployment
   - Note the commit hash

2. **Option A: Revert via Git (Recommended)**:
   ```bash
   git revert <bad-commit-hash>
   git push
   ```
   - GitHub Actions automatically re-deploys
   - Creates a clean audit trail

3. **Option B: Manual Trigger**:
   - Go to Actions → Deploy to GitHub Pages
   - Click the last successful run
   - Click **Re-run all jobs** button

### Rollback Worker (Cloudflare)

1. **Via Cloudflare Dashboard** (Fastest):
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**
   - Select your worker script
   - Go to **Deployments** tab
   - Click the ⋯ menu on a previous version
   - Select **Rollback to this version**

2. **Via Git Revert** (Recommended for audit):
   ```bash
   git revert <bad-commit-hash>
   git push
   ```
   - GitHub Actions automatically re-deploys via deploy-worker.yml
   - Creates a clean commit history

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

### Worker Development

```bash
cd worker

# Start local worker dev server (runs on localhost:8787)
npm run dev

# Run tests
npm test

# Deploy to Cloudflare (requires CLOUDFLARE_API_TOKEN)
npm run deploy

# Tail live logs from worker
npm run tail
```

### Local Environment Variables

To test with a local frontend + worker:

1. Start worker: `cd worker && npm run dev`
2. In another terminal, set environment variable:
   - **Linux/macOS**: `export VITE_API_URL=http://localhost:8787`
   - **Windows**: `set VITE_API_URL=http://localhost:8787`
3. Start frontend: `npm run dev`
4. Frontend will use local worker for API calls

---

## Configuration Reference

### GitHub Actions Secrets Required

```
CLOUDFLARE_ACCOUNT_ID    # From: wrangler whoami or Cloudflare Dashboard
CLOUDFLARE_API_TOKEN     # From: Cloudflare API Tokens page
```

### GitHub Actions Variables Required

```
VITE_API_URL             # Default: https://register-viewer-api.workers.dev
                         # For custom domain, update to your domain
```

### Environment Variables in Workflows

- **VITE_API_URL**: Passed to frontend build, used in api-client.ts
- **CLOUDFLARE_ACCOUNT_ID**: Used by wrangler-action for authentication
- **CLOUDFLARE_API_TOKEN**: Used by wrangler-action for authentication

### Key Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Frontend + Worker CI checks |
| `.github/workflows/deploy.yml` | Frontend deployment to GitHub Pages |
| `.github/workflows/deploy-worker.yml` | Worker deployment to Cloudflare |
| `worker/wrangler.toml` | Worker configuration (KV namespaces, env vars) |
| `worker/package.json` | Worker dependencies and scripts |
| `vite.config.ts` | Frontend build configuration |

---

## Monitoring and Observability

### GitHub Actions Logs

1. Go to **Actions** tab
2. Click a workflow run to view detailed logs
3. Expand individual steps to see command output
4. Search logs for "error" or "Error"

### Frontend Availability

- Visit https://chrissbarr.github.io/register-viewer/
- Check browser console for errors
- Expected response time: <1s

### Worker Health

- Check [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Analytics**
- View requests, response times, errors
- Check uptime/availability metrics

### KV Store Status

- Navigate to **Workers & Pages** → **KV** in Cloudflare Dashboard
- View namespace sizes and keys
- Monitor for quota limits (free tier: 1 GB total)

---

## FAQ

**Q: How do I add a custom domain to the worker?**
A: In Cloudflare Dashboard, go to Workers & Pages → your worker → **Settings** → **Routes**. Add a route like `api.register-viewer.app/*` pointing to your worker.

**Q: Can I test the worker locally before deploying?**
A: Yes! Run `cd worker && npm run dev` to start a local server on `localhost:8787`. Use `VITE_API_URL=http://localhost:8787` in the frontend dev environment.

**Q: What if deployment succeeds but the app doesn't work?**
A: Check: (1) `VITE_API_URL` is correct in GitHub variables, (2) worker KV namespace IDs in wrangler.toml are valid, (3) browser console for errors.

**Q: How do I see worker logs in production?**
A: Run `wrangler tail` in the worker directory to stream live logs. Requires `CLOUDFLARE_API_TOKEN` environment variable.

**Q: Can I deploy manually without pushing code?**
A: Yes! Go to **Actions** → select a workflow → **Run workflow** → **Run workflow** button.

**Q: How do I revert a broken deployment?**
A: Use `git revert` to create a new commit that undoes changes, or use Cloudflare's rollback feature. See "Rollback Procedures" section above.

---

## Support & Debugging

### Enable Debug Logging

In GitHub Actions workflows, add:
```yaml
- name: Debug Info
  run: |
    node --version
    npm --version
    cd worker && npm ls wrangler
```

### Common Issues Checklist

- [ ] All GitHub secrets are set (run `gh secret list` to verify)
- [ ] GitHub variables are set (run `gh variable list` to verify)
- [ ] wrangler.toml has correct KV namespace IDs
- [ ] Cloudflare API token has correct permissions
- [ ] Node.js version matches workflow config (22)
- [ ] All dependencies installed (`npm ci` in both directories)
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] Tests pass locally (`npm test`, `npm run test:e2e`)

### Getting Help

1. Check workflow logs: **Actions** tab → click run → view step details
2. Run tests locally to reproduce failures
3. Check Cloudflare Dashboard for worker/KV status
4. Verify GitHub secrets and variables are correct

