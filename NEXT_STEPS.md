# Next Steps to Deploy

Your repository is ready! Follow these steps:

## ✅ What's Done

- ✅ Git repository initialized
- ✅ All files staged and ready to commit
- ✅ GitHub Actions workflows created
- ✅ Deployment documentation created
- ✅ README updated

## 🚀 Deployment Steps

### Step 1: Commit and Push to GitHub

```bash
# Create your first commit
git commit -m "Initial commit: Flight Tracker app with Cloudflare deployment"

# Create a new repository on GitHub:
# 1. Go to https://github.com/new
# 2. Name it "flight-monitor"
# 3. Don't initialize with README (we have one)
# 4. Click "Create repository"

# Add remote and push (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/flight-monitor.git
git branch -M main
git push -u origin main
```

### Step 2: Get Cloudflare Credentials

1. **Sign up/Login**: https://dash.cloudflare.com/
2. **Get Account ID**: 
   - Found in dashboard URL or right sidebar
   - Looks like: `abc123def456...`
3. **Create API Token**:
   - Go to: https://dash.cloudflare.com/profile/api-tokens
   - Click "Create Token"
   - Use "Edit Cloudflare Workers" template
   - Add permission: "Account: Cloudflare Pages: Edit"
   - Create and **copy the token** (you won't see it again!)

### Step 3: Add GitHub Secrets

Go to: `https://github.com/YOUR_USERNAME/flight-monitor/settings/secrets/actions`

Add these secrets:
- `CLOUDFLARE_API_TOKEN` = (your API token from step 2)
- `CLOUDFLARE_ACCOUNT_ID` = (your Account ID from step 2)
- `VITE_API_URL` = (we'll set this after worker deploys)

### Step 4: Deploy Worker (First Time)

```bash
cd worker
npm install
npx wrangler login  # Login to Cloudflare
npm run deploy
```

**Copy the worker URL** that appears (e.g., `https://flight-monitor-worker.xxx.workers.dev`)

### Step 5: Update VITE_API_URL

1. Go back to GitHub Secrets
2. Update `VITE_API_URL` with your worker URL from step 4

### Step 6: Deploy Frontend via Cloudflare Pages

1. Go to: https://dash.cloudflare.com/ → **Pages**
2. Click **"Create a project"** → **"Connect to Git"**
3. Select your GitHub repository
4. Configure build:
   - **Framework preset**: Vite
   - **Build command**: `cd frontend && npm run build`
   - **Build output directory**: `frontend/dist`
   - **Root directory**: `frontend`
5. Add environment variable:
   - **Variable name**: `VITE_API_URL`
   - **Value**: Your worker URL (from step 4)
6. Click **"Save and Deploy"**

### Step 7: Test Your Deployment

1. Visit your Cloudflare Pages URL (shown after deployment)
2. Open the configuration screen (gear icon)
3. Test with synthetic data
4. Configure your monitoring region

## 📚 Documentation

- **QUICK_START.md**: Quick reference for deployment
- **DEPLOYMENT.md**: Detailed deployment guide
- **README.md**: Project overview and usage

## 🔄 Future Updates

After initial setup:
- Push to `main` branch → Worker auto-deploys via GitHub Actions
- Frontend auto-deploys via Cloudflare Pages (if connected to Git)

## 🆘 Need Help?

- Check **DEPLOYMENT.md** for detailed troubleshooting
- Verify all secrets are set correctly
- Check GitHub Actions logs if worker doesn't deploy
- Check Cloudflare Pages build logs if frontend doesn't deploy

