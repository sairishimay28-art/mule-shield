# MULE SHIELD — Cloud Deployment Guide (Option A)

This guide documents how to deploy **MULE SHIELD** to cloud hosting without manually running local frontend or backend development servers.

---

## 1. Architectural Architecture

- **Frontend**: Cloud Static Web Hosting (e.g., Vercel, Netlify, Cloudflare Pages, or Render Static).
- **Analytical Backend**: Cloud Python Web Service (e.g., Render, Railway, Fly.io, or Heroku).
- **Database & Storage**: Managed Supabase PostgreSQL with Row Level Security (RLS) and REST PostgREST engine.
- **AI Agent Integration**: Compatible with a single Master AI Agent using one AI model API key (future phase).

```
   ┌────────────────────────────────┐
   │        Client Browser          │
   └───────────────┬────────────────┘
                   │
                   ▼
   ┌────────────────────────────────┐       REST API / CORS
   │      Cloud Static Frontend     ├──────────────────────────┐
   │    (Vercel / Netlify / CDN)    │                          │
   └────────────────────────────────┘                          ▼
                                               ┌────────────────────────────────┐
                                               │      Python Cloud Backend      │
                                               │    (Render / Railway / PaaS)   │
                                               └───────────────┬────────────────┘
                                                               │  PostgREST HTTPS
                                                               ▼
                                               ┌────────────────────────────────┐
                                               │       Supabase Cloud DB        │
                                               │      PostgreSQL + RLS Auth     │
                                               └────────────────────────────────┘
```

---

## 2. Required Cloud Services

| Service | Recommended Provider | Purpose |
| :--- | :--- | :--- |
| **Backend Engine** | Render / Railway / Fly.io | Hosts the Python analytical engine (`backend/main.py`). |
| **Frontend UI** | Vercel / Netlify / Cloudflare Pages | Hosts the static HTML/CSS/JS frontend application. |
| **Database & Auth** | Supabase | Cloud PostgreSQL, table schemas, and data persistence. |

---

## 3. Environment Variables & Secret Segregation

### A. Frontend Environment Configuration (Public / Build-Time)
These variables are public and bundled into the browser runtime. **NEVER place service-role keys here.**

| Variable | Scope | Purpose | Example Value |
| :--- | :--- | :--- | :--- |
| `MULE_SHIELD_API_URL` | Frontend (Build) | Base URL of the deployed Python backend | `https://mule-shield-backend.onrender.com` |

*Alternatively, the backend URL can be configured directly in `frontend/js/config.js` or via `<meta name="mule-shield-api-url" content="...">` in `index.html`.*

### B. Backend Environment Variables (Private Server-Only Secrets)
Configure these exclusively in the Python hosting provider's environment variables dashboard. **NEVER expose these to git or the client.**

| Variable | Scope | Purpose | Example Value |
| :--- | :--- | :--- | :--- |
| `PORT` | Backend | Port assigned by cloud hosting provider | `8000` (auto-assigned by host) |
| `HOST` | Backend | Network interface binding | `0.0.0.0` (default) |
| `ALLOWED_ORIGINS` | Backend | Comma-separated list of permitted frontend origins for CORS | `https://your-frontend.vercel.app` |
| `SUPABASE_URL` | Backend | Your Supabase project REST URL | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend | Privileged Supabase service role key (PostgREST server queries) | `sb_secret_...` or JWT secret |
| `SUPABASE_ANON_KEY` | Backend | Supabase client anon key | `eyJhbGciOi...` |

---

## 4. Deploying the Python Backend (e.g., Render)

1. **Create Web Service**:
   - Log in to [Render](https://render.com).
   - Click **New +** -> **Web Service**.
   - Connect your Git repository.
2. **Configure Settings**:
   - **Name**: `mule-shield-backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt` (or leave empty; engine is self-contained with standard library)
   - **Start Command**: `python backend/main.py`
3. **Configure Environment Variables**:
   In the Render Dashboard under **Environment**, add:
   - `HOST`: `0.0.0.0`
   - `SUPABASE_URL`: `https://<your-project-id>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: `<your_service_role_key>`
   - `SUPABASE_ANON_KEY`: `<your_anon_key>`
   - `ALLOWED_ORIGINS`: `https://<your-frontend-domain>.vercel.app` *(update once frontend is deployed)*
4. **Deploy**:
   - Click **Deploy Web Service**.
   - Note your public backend URL (e.g., `https://mule-shield-backend.onrender.com`).

---

## 5. Deploying the Frontend (e.g., Vercel / Netlify)

### Option A: Vercel
1. Log in to [Vercel](https://vercel.com) and click **Add New** -> **Project**.
2. Import the Git repository.
3. In **Project Settings**:
   - **Framework Preset**: `Other`
   - **Root Directory**: `./`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.`
4. In **Environment Variables**, add:
   - `MULE_SHIELD_API_URL`: `https://<your-deployed-backend-url>` (e.g. `https://mule-shield-backend.onrender.com`)
5. Click **Deploy**.

### Option B: Netlify
1. Log in to [Netlify](https://netlify.com) and click **Add new site** -> **Import an existing project**.
2. Select your repository.
3. Build configuration (automatically detected from `netlify.toml`):
   - **Build command**: `npm run build`
   - **Publish directory**: `.`
4. In **Site configuration** -> **Environment variables**, set:
   - `MULE_SHIELD_API_URL`: `https://<your-deployed-backend-url>`
5. Click **Deploy Site**.

---

## 6. Configuring Production CORS

Once the frontend is deployed:
1. Copy the exact frontend URL (e.g., `https://mule-shield.vercel.app` — no trailing slash).
2. Go to your backend hosting dashboard (e.g., Render or Railway).
3. Set or update the `ALLOWED_ORIGINS` environment variable:
   ```env
   ALLOWED_ORIGINS=https://mule-shield.vercel.app
   ```
   *(If you also test from local or preview domains, separate them with commas: `https://mule-shield.vercel.app,http://localhost:3000`)*
4. Trigger a backend redeploy to apply the CORS origin policy.

---

## 7. Supabase Database Configuration

The backend connects directly via HTTPS to Supabase PostgREST.

1. In your **Supabase Dashboard** -> **Project Settings** -> **API**:
   - Copy **Project URL** into backend `SUPABASE_URL`.
   - Copy **service_role (secret)** into backend `SUPABASE_SERVICE_ROLE_KEY`.
   - Copy **anon (public)** into backend `SUPABASE_ANON_KEY`.
2. Ensure database migrations from `supabase/migrations/` or `database/schema.sql` are active.
3. Row Level Security (RLS) is strictly preserved. All backend operations authenticate using the server-side service role over HTTPS without exposing credentials to the client.

---

## 8. Verification & Smoke Testing

### 1. Test Backend Health Endpoint
Run in your terminal (or browser):
```bash
curl -i https://<your-backend-url>/api/health
```
**Expected Response (HTTP 200)**:
```json
{
  "status": "healthy",
  "service": "Mule Shield Analytical Engine",
  "version": "1.0.0",
  "has_dataset": false,
  "transactions_count": 0,
  "database": {
    "configured": true,
    "connected": true,
    "status": "HEALTHY",
    "message": "Connected to Supabase PostgreSQL analytical schema."
  }
}
```

### 2. Test CORS Preflight
```bash
curl -i -X OPTIONS https://<your-backend-url>/api/datasets/upload \
  -H "Origin: https://<your-frontend-url>" \
  -H "Access-Control-Request-Method: POST"
```
**Expected Response (HTTP 204 or 200)**:
- `Access-Control-Allow-Origin: https://<your-frontend-url>`
- `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`

### 3. End-to-End Frontend Verification
1. Open your deployed frontend URL in a browser.
2. Verify sidebar status dot displays green: **Backend Connected**.
3. In **Data Management**:
   - Ingest a sample CSV file or click **Synthetic Demo Scenario**.
   - Verify transaction counts, Louvain modularity score, and detected mule rings appear in the dashboard.
   - Verify Network Intelligence graph visualization renders interactively.
   - Test Docket Creation under **Investigation Cases**.
   - Test CSV Export under **Export Reports**.

---

## 9. Troubleshooting & Log Inspection

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **Sidebar shows "Backend Offline"** | Incorrect API URL or CORS rejection | 1. Check browser DevTools Console for CORS error.<br>2. Verify `ALLOWED_ORIGINS` in backend env matches frontend domain exactly.<br>3. Verify `MULE_SHIELD_API_URL` is set without typos or trailing slashes. |
| **Backend crashes on startup** | Port or Host binding error | 1. Ensure `HOST` is set to `0.0.0.0` on Render/Railway.<br>2. Do not hardcode a specific port; let the host inject `PORT`. |
| **Supabase Status: Unconfigured or Unreachable** | Missing/invalid Supabase keys | 1. Verify `SUPABASE_URL` begins with `https://`.<br>2. Confirm `SUPABASE_SERVICE_ROLE_KEY` does not contain spaces or placeholder strings. |
| **502 Bad Gateway from Cloud Host** | Backend process took too long to bind | In Render/Railway logs, check for syntax errors or missing environment variables. |

---

## 10. Rollback Procedure

- **Frontend Rollback**:
  - In Vercel or Netlify, navigate to **Deployments**.
  - Select the previously working deployment and click **Instant Rollback** / **Publish Deploy**.
- **Backend Rollback**:
  - In Render or Railway, navigate to **Deployments** / **Activity**.
  - Click **Rollback** to the prior working commit or build.
- **Database Safety**:
  - The database schema is backward-compatible. Deletions and updates do not alter migration table schemas.
