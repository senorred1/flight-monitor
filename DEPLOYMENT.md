# Deployment Guide

This guide walks you through deploying the Flight Tracker app to GitHub and Cloudflare.

## Step 1: Prepare GitHub Repository

### 1.1 Create GitHub Repository
1. Go to https://github.com/new
2. Create a new repository named `flight-monitor`
3. **Don't** initialize with README (we already have one)

### 1.2 Push Code to GitHub

```bash
# In your project directory
git add .
git commit -m "Initial commit: Flight Tracker app"

# Add your GitHub repository as remote
git remote add origin https://github.com/YOUR_USERNAME/flight-monitor.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 2: Set Up Cloudflare

### 2.1 Get Cloudflare Credentials

1. **Account ID**:
   - Go to https://dash.cloudflare.com/
   - Click on any domain or go to Workers & Pages
   - Your Account ID is in the URL or in the right sidebar

2. **API Token**:
   - Go to https://dash.cloudflare.com/profile/api-tokens
   - Click "Create Token"
   - Use "Edit Cloudflare Workers" template
   - Add permissions:
     - Account: Cloudflare Pages: Edit
     - Account: Workers: Edit
   - Click "Continue to summary" → "Create Token"
   - **Copy the token immediately** (you won't see it again!)

### 2.2 Add GitHub Secrets

1. Go to your GitHub repository
2. Settings → Secrets and variables → Actions
3. Add these secrets:
   - `CLOUDFLARE_API_TOKEN`: Your API token from step 2.1
   - `CLOUDFLARE_ACCOUNT_ID`: Your Account ID from step 2.1
   - `VITE_API_URL`: Will be set after worker deployment (see step 3.3)

## Step 3: Deploy Worker

### 3.1 Manual Deployment (First Time)

```bash
cd worker
npm install

# Login to Cloudflare (if not already)
npx wrangler login

# Deploy
npm run deploy
```

After deployment, note the worker URL (e.g., `https://flight-monitor-worker.your-subdomain.workers.dev`)

### 3.2 Automatic Deployment

Once you've pushed to GitHub and added secrets, future changes to `worker/` will auto-deploy via GitHub Actions.

## Step 4: Deploy Frontend

### 4.1 Update GitHub Secret

1. Go to GitHub repository → Settings → Secrets
2. Update `VITE_API_URL` with your worker URL from step 3.1:
   ```
   https://flight-monitor-worker.your-subdomain.workers.dev
   ```

### 4.2 Deploy via Cloudflare Pages Dashboard

1. Go to https://dash.cloudflare.com/ → Pages
2. Click "Create a project" → "Connect to Git"
3. Select your GitHub repository
4. Configure build:
   - **Framework preset**: Vite
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `frontend`
5. Add environment variable:
   - Variable: `VITE_API_URL`
   - Value: Your worker URL (from step 3.1)
6. Click "Save and Deploy"

### 4.3 Alternative: Automatic Deployment

The GitHub Action will deploy on push, but you need to set up the Pages project first via the dashboard (step 4.2).

## Step 5: Configure OpenSky API (Optional)

If you want to use real flight data instead of synthetic:

```bash
cd worker

# Set your OpenSky credentials
npx wrangler secret put OPENSKY_USERNAME
# Enter your username when prompted

npx wrangler secret put OPENSKY_PASSWORD
# Enter your password when prompted

# Update worker code
# Set USE_SYNTHETIC_DATA = false in worker/src/index.js
```

Then redeploy:
```bash
npm run deploy
```

## Step 6: Test Deployment

1. Visit your Cloudflare Pages URL
2. Open the configuration screen (gear icon)
3. Verify the monitoring region settings
4. Test with synthetic data first
5. Enable chime if desired

## Troubleshooting

### Worker Not Deploying
- Check GitHub Actions logs
- Verify `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets are correct
- Ensure `wrangler.toml` is configured correctly

### Frontend Can't Connect to Worker
- Verify `VITE_API_URL` is set correctly in Cloudflare Pages environment variables
- Check worker URL is accessible
- Ensure CORS is enabled in worker (it is by default)

### Build Failures
- Check Node.js version (should be 18+)
- Verify all dependencies are in `package.json`
- Check build logs in Cloudflare Pages dashboard

## Custom Domain (Optional)

1. In Cloudflare Pages, go to your project → Custom domains
2. Add your domain
3. Follow DNS setup instructions
4. Update `VITE_API_URL` if needed

