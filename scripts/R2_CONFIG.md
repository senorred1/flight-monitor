# R2 Configuration for Aircraft Database Sync

## Required Environment Variables

Before running `npm run sync-aircraft-db`, you need to set the following environment variables:

```bash
# Your Cloudflare Account ID (found in Cloudflare Dashboard)
export R2_ACCOUNT_ID="f4ff7aa620b854de61e0e3d9254fd1d1"

# R2 Access Key ID (create in Cloudflare Dashboard → R2 → Manage R2 API Tokens)
export R2_ACCESS_KEY_ID="604a89c12dc65b1dbb11ed40088b7e80"

# R2 Secret Access Key (create in Cloudflare Dashboard → R2 → Manage R2 API Tokens)
export R2_SECRET_ACCESS_KEY="9c4fe281cc7c101088e05cec9cefea3812af386bf47b38d8ff685d7317644430"

# R2 Bucket Name (create a bucket in Cloudflare Dashboard → R2)
export R2_BUCKET_NAME="flight-monitor"

# Optional: Object key/path in R2 bucket (default: aircraft-db.json.gz)
export R2_OBJECT_KEY="aircraft-db.json.gz"
```

## Setting Up R2

1. **Create an R2 Bucket**:
   - Go to Cloudflare Dashboard → R2
   - Click "Create bucket"
   - Enter a bucket name (e.g., `flight-monitor-data`)

2. **Create R2 API Tokens**:
   - Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens
   - Click "Create API token"
   - Give it a name and permissions (Object Read & Write)
   - Copy the Access Key ID and Secret Access Key

3. **Get Your Account ID**:
   - Found in Cloudflare Dashboard URL or right sidebar
   - Format: 32-character hex string

## Usage

After setting the environment variables, run:

```bash
npm run sync-aircraft-db
```

The script will:
1. Download the latest aircraft database CSV from OpenSky Network
2. Parse and extract relevant fields (icao24, registration, type, owner, etc.)
3. Convert to JSON indexed by icao24
4. Compress with gzip
5. Upload to your R2 bucket

