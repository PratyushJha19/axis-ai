# AXIS — Setup and Execution Guide

This document provides a comprehensive, step-by-step guide for setting up, configuring, running, and verifying the **AXIS** personal AI operating system on your machine (specifically Windows, with cross-platform notes).

---

## 1. Project Overview & Architecture

AXIS is built as a **modular TypeScript monorepo** with strict architectural boundaries, fail-closed security, and multi-user support (isolated workspaces with Bring-Your-Own-Key AI configurations).

### Monorepo Structure

| Directory / Workspace | Role & Purpose |
| --------------------- | -------------- |
| **`apps/web`** | Frontend SPA built with **React 19**, **Vite**, and vanilla CSS. Served as static assets in production or run with HMR in dev. |
| **`services/api`** | Backend HTTP service built with **Express 5**, **Helmet**, **express-session**, **CSRF/Origin protection**, and rate limiting. Serves REST endpoints under `/api/v1` and health checks. |
| **`services/worker`** | Independent background daemon for durable reminders, retry loops, lease reconciliation, and outbox notification delivery. Runs independently of the API and LLMs. |
| **`packages/config`** | Typed runtime configuration and environment variable loading with validation. |
| **`packages/database`** | PostgreSQL client wrapper using **Kysely** with typed schema definitions and connection pooling. |
| **`packages/domain`** | Core business logic, domain error models, reminder scheduling, AI provider integrations (Groq), and notification adapters. |
| **`packages/observability`** | Structured logger powered by **Pino** (content-free, secret-redacted logging). |
| **`packages/shared`** | Shared utilities, date/time normalization, and temporal helpers. |
| **`database/migrations`** | Numbered SQL migrations (`001-foundation` through `005-notifications`). |
| **`scripts/`** | PowerShell and Node utility scripts for setup, startup, key rotation, and verification. |
| **`tests/`** | Unit, security, integration, and Playwright end-to-end tests. |

---

## 2. System Prerequisites

Ensure you have the following installed on your machine before starting:

1. **Node.js**: `v24.x` (Engine requirement: `>=24 <25`).
   - Check with: `node -v`
2. **npm**: `v11.x` (Recommended: `11.16.0` or latest npm 11).
   - Check with: `npm -v`
3. **PostgreSQL 18**:
   - The default Windows launcher expects binaries at:
     ```text
     C:\Program Files\PostgreSQL\18\bin
     ```
   - If PostgreSQL is installed in another location or added to your system `PATH`, set the `PG_BIN` environment variable (e.g., `$env:PG_BIN = "D:/PostgreSQL/bin"`).
4. **PowerShell**:
   - Built-in Windows PowerShell (`powershell.exe`) is supported. PowerShell 7 (`pwsh`) is not required.
   - If script execution is restricted, allow it for the current process:
     ```powershell
     Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
     ```
5. **Git**: Initialized in this workspace.

---

## 3. Environment Configuration (`.env`)

AXIS uses an ignored `.env` file at the root of the project for server secrets and database URLs.

### 3.1 Create `.env`

Copy the template:
```powershell
Copy-Item .env.example .env
```
*(On Linux/macOS: `cp .env.example .env`)*

### 3.2 Environment Variables Reference

Below is the complete breakdown of configuration options:

```dotenv
# ==========================================
# Core Database & Server
# ==========================================
# Connection URL for your primary PostgreSQL database
DATABASE_URL=postgresql://axis_local:<password>@127.0.0.1:55432/axis_dev

# Connection URL for isolated integration tests (must be an empty/disposable DB)
TEST_DATABASE_URL=

# Port for the HTTP API (default: 3000)
PORT=3000

# Logging verbosity: fatal, error, warn, info, debug, trace (default: info)
LOG_LEVEL=info

# External origin URL (used for CORS, cookies, and OAuth callbacks)
APP_ORIGIN=http://localhost:3000

# ==========================================
# Authentication (Google OAuth 2.0)
# ==========================================
# Google Web OAuth Client ID & Secret
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Cryptographic random string (minimum 48 characters) for signing session cookies
SESSION_SECRET=

# ==========================================
# Reminders & Background Worker Policies
# ==========================================
REMINDER_LEASE_MS=60000
REMINDER_TIMEOUT_MS=5000
REMINDER_MAX_ATTEMPTS=3
REMINDER_MAX_RECONCILIATIONS=3
REMINDER_RETRY_BASE_MS=30000
REMINDER_RETRY_CAP_MS=900000

# ==========================================
# AI Provider Foundation (BYOK - Groq)
# ==========================================
# 32-byte base64 encryption key for encrypting stored user provider keys
AI_CREDENTIALS_ENCRYPTION_KEY=
AI_CREDENTIALS_KEY_VERSION=v1
AI_CREDENTIALS_PREVIOUS_KEYS=
AI_REQUEST_TIMEOUT_MS=20000
AI_REQUESTS_PER_MINUTE=20
AI_MAX_OUTPUT_TOKENS=1024

# ==========================================
# Messaging & Notifications (M3)
# ==========================================
# Delivery mode: 'mock' (default, safe for local dev) or 'live'
NOTIFICATION_MODE=mock
WHATSAPP_SANDBOX_MODE=true
NOTIFICATION_PUBLIC_ORIGIN=

# Twilio Sandbox credentials (if NOTIFICATION_MODE=live)
TWILIO_SANDBOX_ACCOUNT_SID=
TWILIO_SANDBOX_AUTH_TOKEN=
TWILIO_SANDBOX_WHATSAPP_FROM=
TWILIO_SANDBOX_CONTENT_SID=

# Resend Email credentials (if NOTIFICATION_MODE=live)
RESEND_API_KEY=
EMAIL_FROM=
RESEND_WEBHOOK_SECRET=
```

---

## 4. Step-by-Step Setup Guide

### Step 1: Install Dependencies
Run from the root directory:
```powershell
npm ci
```
*(If updating lockfile or developing: `npm install`)*

---

### Step 2: Database Setup

AXIS requires a running PostgreSQL instance. You have two options:

#### Option A: Using the Isolated Local Cluster (Recommended on Windows)
The project includes support for a local, self-contained PostgreSQL cluster in `.local/pgdata` running on port `55432`:

1. Initialize the cluster (only if `.local/pgdata` does not exist):
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\initdb.exe" -D .local/pgdata -U axis_local --auth=scram-sha-256 --encoding=UTF8 --pwfile=local-pass.txt
   ```
2. Start the cluster:
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D .local/pgdata -l .local/postgres.log -o "-h 127.0.0.1 -p 55432" start
   ```
3. Create the development database:
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -h 127.0.0.1 -p 55432 -U axis_local axis_dev
   ```
4. Update `DATABASE_URL` in `.env`:
   ```dotenv
   DATABASE_URL=postgresql://axis_local:<your_password>@127.0.0.1:55432/axis_dev
   ```

#### Option B: Using an Existing System PostgreSQL Instance
If you already have PostgreSQL running on default port `5432`:
1. Create a database named `axis_dev` and a user with proper privileges.
2. Update `DATABASE_URL` in `.env`:
   ```dotenv
   DATABASE_URL=postgresql://postgres:<your_password>@127.0.0.1:5432/axis_dev
   ```

---

### Step 3: Run Database Migrations

Apply all schema migrations (001 through 005) to your database:
```powershell
npm run db:migrate
```
*Migrations ensure all tables (`users`, `sessions`, `memories`, `tasks`, `reminders`, `ai_configs`, `notifications`, etc.) are up to date.*

---

### Step 4: Configure Google Authentication

AXIS uses Google OpenID Connect for user authentication:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Configure the **OAuth Consent Screen** (User Type: External / Testing mode; add your test Google account as a test user).
4. Go to **Credentials** -> **Create Credentials** -> **OAuth Client ID**.
5. Select Application Type: **Web application**.
6. Set the **Authorized redirect URI** to:
   ```text
   http://localhost:3000/auth/google/callback
   ```
7. Run the automated configuration script:
   ```powershell
   npm run setup:google
   ```
   *Enter your Google Client ID and Secret when prompted. The script automatically updates your `.env` with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and generates a secure `SESSION_SECRET`.*

---

### Step 5: Configure AI Provider (Groq BYOK)

AXIS uses AES-256-GCM to securely encrypt user-supplied API keys:

1. Run the AI encryption setup script:
   ```powershell
   npm run setup:ai
   ```
   *This automatically generates `AI_CREDENTIALS_ENCRYPTION_KEY` in your `.env` without printing it.*
2. Start the application (see Section 5 below) and sign in via Google.
3. In the web dashboard, open **AI Settings**.
4. Select **Groq**, choose a supported model (`llama-3.3-70b-versatile` or `llama-3.1-8b-instant`), enter your personal Groq API key, test the connection, and save.
   *(Each user manages their own key; no shared API key is stored in the server `.env`.)*

---

### Step 6: Configure Notifications & Messaging (M3)

- By default, `NOTIFICATION_MODE=mock` is set.
- In mock mode, reminder deliveries are simulated without sending real WhatsApp messages or emails.
- To use Twilio Sandbox for WhatsApp or Resend for Email, set `NOTIFICATION_MODE=live` and populate the respective credentials in `.env`.

---

## 5. Running the Application

### Option 1: The All-in-One Local Launcher (Recommended)

Run:
```powershell
npm run dev
```

What this script (`scripts/start-local.ps1`) does:
1. Starts the isolated PostgreSQL cluster at `.local/pgdata` (if installed there).
2. Runs database migrations (`npm run db:migrate`).
3. Builds the React dashboard (`npm run build`).
4. Starts the API server serving both the API endpoints and the frontend dashboard at **http://localhost:3000**.

> **Note for Reminders & Background Jobs:**
> Open a **second terminal** to run the independent worker:
> ```powershell
> npm run dev:worker
> ```

---

### Option 2: Running Services Individually

If you prefer to start services independently:

1. **Terminal 1 — Database Migrations & API Server:**
   ```powershell
   npm run db:migrate
   npm run build
   npm run dev:api
   ```
   *Serves the backend and dashboard at `http://localhost:3000`.*

2. **Terminal 2 — Background Reminder Worker:**
   ```powershell
   npm run dev:worker
   ```
   *Polls the database and manages reminder schedules and notification claims.*

3. **Terminal 3 (Optional) — Frontend Vite Dev Server with Hot Module Reload (HMR):**
   ```powershell
   npm run dev --workspace @axis/web
   ```
   *Runs Vite at `http://localhost:5173` with automatic API proxying to port 3000.*

---

## 6. Health Checks & Verification

### HTTP Health Endpoints

- **Liveness:**
  ```text
  GET http://localhost:3000/health/live
  Response: { "status": "alive" }
  ```
- **Readiness (Checks Database & Migrations):**
  ```text
  GET http://localhost:3000/health/ready
  Response: { "status": "ready" }
  ```
- **Auth Status:**
  ```text
  GET http://localhost:3000/auth/status
  Response: { "configured": true }
  ```

### Worker Health
In a terminal, verify that the reminder worker is running and sending heartbeats:
```powershell
npm run worker:health
```
*(Exits with code 0 if the heartbeat is within 90 seconds and schema is ready).*

---

## 7. Testing & Code Quality

AXIS enforces strict code quality and test requirements:

| Command | Action |
| ------- | ------ |
| `npm run check` | Runs full suite: Prettier format check, ESLint, TypeScript typecheck, and unit/security tests. |
| `npm test` | Runs all Node.js native unit and security test suites using `tsx --test`. |
| `npm run typecheck` | Type-checks both backend and frontend TypeScript definitions (`tsc --noEmit`). |
| `npm run lint` | Runs ESLint across all services, apps, and packages. |
| `npm run format` | Automatically formats all files using Prettier. |
| `npm run test:integration` | Runs integration tests against an isolated test database (requires `TEST_DATABASE_URL`). |
| `npm run test:e2e` | Runs Playwright browser-level end-to-end tests. |
| `./scripts/verify-local.ps1` | Automated Windows PowerShell verification script. |

---

## 8. Stopping the Services

1. In the terminals running `npm run dev` and `npm run dev:worker`, press `Ctrl + C`.
2. To cleanly stop the isolated PostgreSQL cluster:
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D .local/pgdata -m fast stop
   ```

---

## 9. Common Troubleshooting

| Issue | Cause & Resolution |
| ----- | ------------------ |
| **`UNAUTHENTICATED` / Setup Page shown** | Google OAuth credentials are not configured in `.env`. Run `npm run setup:google` or edit `.env`. |
| **`redirect_uri_mismatch` during Google Login** | Ensure the authorized redirect URI in Google Cloud Console matches `http://localhost:3000/auth/google/callback` exactly. |
| **`DEPENDENCY_UNAVAILABLE` on `/health/ready`** | PostgreSQL is not running or migrations have not been applied. Run `npm run db:migrate`. |
| **AI requests fail with configuration error** | Run `npm run setup:ai` to generate the server encryption key, restart the API server, then enter your Groq API key in **AI Settings** on the dashboard. |
| **Port 3000 already in use** | Stop any existing Node process running on port 3000 using Task Manager or PowerShell (`Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess`). |
| **Worker reports no heartbeats** | Make sure `npm run dev:worker` is running in an active terminal alongside the API server. |
