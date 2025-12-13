# Flight Tracker

A lightweight React application with Cloudflare Workers backend for tracking aircraft entering a defined circular monitoring region. Designed for iPad use.

## Features

- Full-screen flight information cards
- Circular region detection (configurable radius: 1, 2, 3, or 5 miles)
- OpenSky API integration with rate limiting (30s minimum interval)
- Synthetic data mode for testing
- Configurable monitoring region with center point and radius
- Chime notification when aircraft enters region
- iPad-optimized UI

## Setup

### Prerequisites

- Node.js 18+ installed
- Cloudflare account (for deployment)
- OpenSky API credentials (optional, for production)

### Installation

1. Install root dependencies:
```bash
npm install
```

2. Install frontend dependencies:
```bash
cd frontend
npm install
```

3. Install worker dependencies:
```bash
cd ../worker
npm install
```

### Configuration

1. **OpenSky API Credentials** (for production):
   - Sign up at https://openskynetwork.org/
   - Add credentials to Cloudflare Workers secrets:
     ```bash
     cd worker
     wrangler secret put OPENSKY_USERNAME
     wrangler secret put OPENSKY_PASSWORD
     ```

2. **Monitoring Region**:
   - Configure via the app's configuration screen (gear icon)
   - Set center point (latitude/longitude) and radius (1, 2, 3, or 5 miles)
   - Or edit `worker/src/index.js` to update `DEFAULT_REGION`

3. **API URL** (for frontend):
   - **For local testing**: No configuration needed! The frontend defaults to `http://localhost:8787`
   - **For production**: Create `frontend/.env`:
     ```
     VITE_API_URL=https://your-worker.your-subdomain.workers.dev
     ```

## Quick Start (Local Testing)

**You can test everything locally without deploying to Cloudflare!**

1. **Start the Worker** (in one terminal):
   ```bash
   cd worker
   npm install
   npm run dev
   ```
   This starts the Cloudflare Worker locally on `http://localhost:8787`

2. **Start the Frontend** (in another terminal):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   This starts the React app on `http://localhost:3000`

3. **Find your computer's IP address**:
   ```bash
   ./get-local-ip.sh
   ```
   Or manually: `ifconfig | grep "inet " | grep -v 127.0.0.1`

4. **Configure API URL for iPad access**:
   Create `frontend/.env` file with your computer's IP:
   ```
   VITE_API_URL=http://YOUR_IP_ADDRESS:8787
   ```
   Replace `YOUR_IP_ADDRESS` with the IP from step 3 (e.g., `192.168.1.215`)

5. **Restart the frontend** (if it's already running, stop and restart it)

6. **Open in browser on iPad**: 
   - Make sure your iPad is on the same Wi-Fi network
   - Navigate to `http://YOUR_IP_ADDRESS:3000` (use the IP from step 3)

**Troubleshooting "Failed to fetch" error:**
- Make sure the worker is running (`npm run dev` in the worker directory)
- Make sure both devices are on the same Wi-Fi network
- Check that your firewall allows connections on ports 3000 and 8787
- Verify the IP address in `frontend/.env` matches your computer's IP

The app uses synthetic data by default, so you'll see test flights appearing randomly.

## Development

### Frontend (React)
```bash
npm run dev:frontend
```
Runs on http://localhost:3000

### Worker (Cloudflare)
```bash
npm run dev:worker
```
Runs on http://localhost:8787 (local development server - no deployment needed!)

## Deployment

### Prerequisites
1. **Cloudflare Account**: Sign up at https://dash.cloudflare.com/
2. **GitHub Account**: For repository hosting
3. **Cloudflare API Token**: 
   - Go to Cloudflare Dashboard → My Profile → API Tokens
   - Create token with:
     - Workers:Edit permissions
     - Account:Cloudflare Pages:Edit permissions
     - Zone:Zone:Read, DNS:Edit (if using custom domain)

### Deploy Worker to Cloudflare

**Option 1: Manual Deployment**
```bash
cd worker
npm install
npm run deploy
```

**Option 2: GitHub Actions (Recommended)**
1. Push code to GitHub
2. Add secrets to GitHub repository:
   - `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token
   - `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID (found in dashboard URL)
3. Push to `main` branch - worker will auto-deploy

### Deploy Frontend to Cloudflare Pages

**Option 1: Manual Deployment via Dashboard**
1. Go to Cloudflare Dashboard → Pages
2. Create new project → Connect to Git
3. Select your repository
4. Build settings:
   - Framework preset: Vite
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `frontend`
5. Environment variables:
   - Add `VITE_API_URL` with your worker URL (e.g., `https://flight-monitor-worker.your-subdomain.workers.dev`)

**Option 2: GitHub Actions**
1. Add `VITE_API_URL` secret to GitHub (your worker URL)
2. Push to `main` branch - frontend will auto-deploy

**Option 3: Wrangler CLI**
```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=flight-monitor
```

### After Deployment

1. **Update Frontend Environment Variable**:
   - Get your worker URL from Cloudflare Dashboard
   - Update `VITE_API_URL` in Cloudflare Pages environment variables
   - Or update in GitHub secrets if using Actions

2. **Configure OpenSky Credentials** (if using real API):
   ```bash
   cd worker
   wrangler secret put OPENSKY_USERNAME
   wrangler secret put OPENSKY_PASSWORD
   ```

3. **Test the deployment**:
   - Visit your Cloudflare Pages URL
   - Open configuration and verify settings
   - Test with synthetic data first

## Testing

The app uses synthetic data by default. To switch to real OpenSky API:
1. Set `USE_SYNTHETIC_DATA = false` in `worker/src/index.js`
2. Configure OpenSky credentials as secrets in Cloudflare Workers

## Notes

- API calls are rate-limited to once every 30 seconds
- Frontend polls the API every 5 seconds
- Monitoring region uses circular detection (center point + radius)
- Airport origin/destination detection is simplified (uses callsign prefix)
- Configuration is stored in browser localStorage and synced to backend

