# Quick Deployment Steps

## 1. Push to GitHub

```bash
# Create initial commit
git commit -m "Initial commit: Flight Tracker app"

# Create GitHub repository at https://github.com/new
# Then add remote and push:
git remote add origin https://github.com/YOUR_USERNAME/flight-monitor.git
git branch -M main
git push -u origin main
```

## 2. Get Cloudflare Credentials

1. **Account ID**: 
   - Go to https://dash.cloudflare.com/
   - Found in URL or right sidebar

2. **API Token**:
   - Go to https://dash.cloudflare.com/profile/api-tokens
   - Create token with "Edit Cloudflare Workers" template
   - Add "Cloudflare Pages: Edit" permission
   - Copy token immediately

## 3. Add GitHub Secrets

Go to: `https://github.com/YOUR_USERNAME/flight-monitor/settings/secrets/actions`

Add:
- `CLOUDFLARE_API_TOKEN` = (your token)
- `CLOUDFLARE_ACCOUNT_ID` = (your account ID)
- `VITE_API_URL` = (set after worker deploys)

## 4. Deploy Worker (First Time)

```bash
cd worker
npm install
npx wrangler login
npm run deploy
```

Copy the worker URL (e.g., `https://flight-monitor-worker.xxx.workers.dev`)

## 5. Update VITE_API_URL Secret

In GitHub secrets, update `VITE_API_URL` with your worker URL.

## 6. Deploy Frontend via Cloudflare Pages

1. Go to https://dash.cloudflare.com/ → Pages
2. Create project → Connect to Git
3. Select your repository
4. Build settings:
   - Framework: Vite
   - Build command: `cd frontend && npm run build`
   - Output directory: `frontend/dist`
   - Root: `frontend`
5. Environment variable:
   - `VITE_API_URL` = (your worker URL)
6. Deploy!

## Done! 🎉

Your app will be live at: `https://flight-monitor.pages.dev` (or your custom domain)

