# Next Targets:

1. User can talk to the connected LLM through the telegram bot and get small agentic tasks done and get planning and suggestions according to the upcoming and ongoing tasks and those plans and suggestion should be visible on the overview page.
2. User can view, add, edit and delete things like reminders, memory, projects and tasks by just talking to the bot, by using bot's specific commands or normal texting.

# AXIS — Complete Setup and Run Guide

This document provides a comprehensive, step-by-step guide for setting up, configuring, running, and verifying the **AXIS** personal AI operating system on your machine (specifically Windows, with cross-platform notes).

Updated for Telegram and dynamic Groq model selection on 2026-10-15. Live Telegram acceptance remains pending;
delivery defaults to simulation. This guide does not authorize deployment or live sends.

## Quick start — this configured Windows workspace

If you have already configured Google sign-in, server AI encryption and the local PostgreSQL cluster, use these daily startup steps. Preserve the existing `.env` and `.local/pgdata`.
If AXIS is already running, open it instead of starting duplicate processes.

In the first PowerShell terminal:

```powershell
Set-Location G:\axis-ai
npm run dev
```

Once the API starts, open a second terminal:

```powershell
Set-Location G:\axis-ai
npm run dev:worker
```

Open **http://localhost:3000** and sign in with Google. Keep both terminals open.
In **AI Settings**, enter your Groq key and click **Load Groq models**. Choose a text-chat model from the suggestions or type its exact model ID, then **Save AI settings**. Enable the test consent checkbox and click **Test saved connection** to verify account access. Catalog lookup does not generate text; connection testing may use up to 1,024 output tokens. Audio models require an audio interface and are not available in AXIS text chat. If Groq rejects a model, check the project's model permissions or choose another current text model. Restart AXIS with `npm run dev` after updating the code.

Each user adds their own Groq key in **AI Settings** to use chat. No AI key is
required for tasks, memory or reminders. Confirm your IANA timezone in Settings;
`Asia/Kolkata` is appropriate for India. Some runtimes display the equivalent
`Asia/Calcutta` alias.

Check the worker with `npm run worker:health`. The application exposes
`/health/live` and `/health/ready`; both should return HTTP 200.
With `NOTIFICATION_MODE=mock`, reminders create simulated receipts only.

For a new machine, follow the remaining sections. No Docker is required.

## Choose what you want to enable

| Feature                            | One-time operator setup                            | Each user's setup                           | Must stay running                                 |
| ---------------------------------- | -------------------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| Dashboard, projects, tasks, memory | Node, PostgreSQL, Google OAuth                     | Sign in with a verified Google account      | PostgreSQL and API                                |
| AI chat                            | Server encryption key                              | Personal Groq API key and text model        | PostgreSQL and API                                |
| Simulated reminders                | Default `NOTIFICATION_MODE=mock`                   | Timezone and reminder schedule              | PostgreSQL and worker; API for managing reminders |
| Telegram notifications             | Dedicated bot token and `live` mode                | Link private Telegram chat and save consent | PostgreSQL and worker; API for setup/history      |
| Optional email fallback            | Resend, verified sending domain and signed webhook | Enable email and fallback with consent      | PostgreSQL, API/webhook endpoint and worker       |

The server encryption secret is **not** a Groq API key. The Google OAuth client and Telegram bot belong to the AXIS operator. Each user's Groq key, records, timezone and linked notification destination are separate. Users do not each need a Google Cloud project or a Telegram bot.

### Guide contents

1. Project structure
2. Prerequisites
3. Environment file and variable reference
4. First-time setup: dependencies, database, Google, Groq, Telegram and optional email
5. Starting the services, including separate frontend development
6. Health checks and first-run checklist
7. Automated verification
8. Shutdown and restart
9. Troubleshooting
10. Updates, backup precautions and limitations

---

## 1. Project Overview & Architecture

AXIS is built as a **modular TypeScript monorepo** with strict architectural boundaries, fail-closed security, and multi-user support (isolated workspaces with Bring-Your-Own-Key AI configurations).

### Monorepo Structure

| Directory / Workspace        | Role & Purpose                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`apps/web`**               | Frontend SPA built with **React 19**, **Vite**, and vanilla CSS. Served as static assets in production or run with HMR in dev.                                                          |
| **`services/api`**           | Backend HTTP service built with **Express 5**, **Helmet**, **express-session**, **CSRF/Origin protection**, and rate limiting. Serves REST endpoints under `/api/v1` and health checks. |
| **`services/worker`**        | Independent background daemon for durable reminders, retry loops, lease reconciliation, and outbox notification delivery. Runs independently of the API and LLMs.                       |
| **`packages/config`**        | Typed runtime configuration and environment variable loading with validation.                                                                                                           |
| **`packages/database`**      | PostgreSQL client wrapper using **Kysely** with typed schema definitions and connection pooling.                                                                                        |
| **`packages/domain`**        | Core business logic, domain error models, reminder scheduling, AI provider integrations (Groq), and notification adapters.                                                              |
| **`packages/observability`** | Structured logger powered by **Pino** (content-free, secret-redacted logging).                                                                                                          |
| **`packages/shared`**        | Shared utilities, date/time normalization, and temporal helpers.                                                                                                                        |
| **`database/migrations`**    | Numbered SQL migrations (`001-foundation` through `008-reminder-archive`).                                                                                                              |
| **`scripts/`**               | PowerShell and Node utility scripts for setup, startup, key rotation, and verification.                                                                                                 |
| **`tests/`**                 | Unit, security, integration, and Playwright end-to-end tests.                                                                                                                           |

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
5. **Git**: Optional for running the application. Repository initialization is not a setup prerequisite.

---

## 3. Environment Configuration (`.env`)

AXIS uses an ignored `.env` file at the root of the project for server secrets and database URLs.

### 3.1 Create `.env`

Create the template only if `.env` is absent; never overwrite existing credentials:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
  Copy-Item -LiteralPath .env.example -Destination .env
}
```

The npm startup helpers are Windows-specific. On other systems use the individual
Node/npm commands with a separately managed PostgreSQL instance.

### 3.2 Environment Variables Reference

The following covers common settings. `.env.example` lists all supported names;
blank optional settings use application defaults. Fill secrets privately.

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

# Browser origin for Origin validation and OAuth callbacks
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

# Telegram bot credentials (if NOTIFICATION_MODE=live)
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
# Legacy WhatsApp dispatch is disabled


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
Set-Location G:\axis-ai
npm ci
```

_(If updating lockfile or developing: `npm install`)_

---

### Step 2: Database Setup

AXIS requires a running PostgreSQL instance. You have two options:

#### Option A: Using the Isolated Local Cluster (Recommended on Windows)

The project includes support for a local, self-contained PostgreSQL cluster in `.local/pgdata` running on port `55432`:

1. Initialize the cluster (only if `.local/pgdata` does not exist):
   ```powershell
   New-Item -ItemType Directory -Force .local | Out-Null
   & "C:\Program Files\PostgreSQL\18\bin\initdb.exe" -D .local/pgdata -U axis_local --auth=scram-sha-256 --encoding=UTF8 --pwprompt
   ```
   Enter a new local database password at the hidden prompt. Store it securely.
   Do not run this command against an existing cluster.
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

Use a dedicated application database role where possible. Replace placeholders
privately and URL-encode special characters in the password. For this option,
use **Running Services Individually** below: `npm run dev` always manages the
project's `.local/pgdata` cluster, even when DATABASE_URL points elsewhere.

---

### Step 3: Run Database Migrations

Apply all schema migrations (001 through 008) to your database:

```powershell
npm run db:migrate
```

Stop the API and worker before upgrading the schema. Migrations preserve existing
records and apply only pending changes. The current schema includes migration 005
for notification preferences, jobs, events and attempt history. Restart both
processes after migrations succeed.

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
   _Enter your Google Client ID and Secret when prompted. The script automatically updates your `.env` with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and generates a secure `SESSION_SECRET`._

---

### Step 5: Configure AI Provider (Groq BYOK)

AXIS uses AES-256-GCM to securely encrypt user-supplied API keys:

1. Run the AI encryption setup script:
   ```powershell
   npm run setup:ai
   ```
   _This automatically generates `AI_CREDENTIALS_ENCRYPTION_KEY` in your `.env` without printing it._
2. Start the application (see Section 5 below) and sign in via Google.
3. In the web dashboard, open **AI Settings**.
4. Open the [Groq Console](https://console.groq.com/keys), sign in and create a personal API key. Copy it privately into AXIS's **Provider API key** password field, not into chat or `.env`.
5. Click **Load Groq models**. This reads the current catalog using the entered key; it does not save the key or generate text.
6. In **AI model**, choose a suggested text model or type its exact ID. Audio-only models cannot run in this text-chat interface. Catalog membership does not guarantee your Groq project has access.
7. Click **Save AI settings**. The password field clears after the encrypted key is saved.
8. Check the test consent box, then click **Test saved connection**. This makes a provider request with up to 1,024 output tokens and may use quota. Expect **Connection verified**.
9. Open **Chat**, enter a short message and click **Send to provider**. Provider usage limits and charges apply.

Each user repeats steps 2–9 with their own account and key. On later visits, leave the key field blank to retain the saved key. You can load models using that saved key. **Delete stored key** removes AXIS's copy; revoke the key in Groq separately if needed.

Back up the server encryption key securely with the database. Do not replace an
existing key to troubleshoot authentication: previously saved provider keys need
it to decrypt. `npm run setup:ai` preserves a configured key. Restart the API
after setup. See [AI operations](docs/10-m1-5-ai-provider-foundation.md) for rotation.

---

### Step 6: Configure Telegram notifications

Telegram is the current primary notification channel. Twilio/WhatsApp delivery is disabled; old variables and historical records do not enable it. Telegram-only setup needs no public URL, domain, webhook or tunnel.

#### A. Create one bot for the application

1. Open Telegram and find the verified **@BotFather** account.
2. Send `/newbot`.
3. Enter a display name, for example `AXIS Reminders`.
4. Choose an available username ending in `bot`.
5. Save the token privately. Use a dedicated bot so another application or webhook does not compete for its updates. These are Telegram's [official bot creation steps](https://core.telegram.org/bots/tutorial).

#### B. Configure the operator's environment

Stop the API and worker, then edit the root `.env` without removing its other values:

```dotenv
NOTIFICATION_MODE=live
TELEGRAM_BOT_TOKEN=REPLACE_WITH_YOUR_PRIVATE_BOT_TOKEN
TELEGRAM_BOT_USERNAME=your_actual_bot_username
```

Use the bot username without `@`. Keep optional email settings blank if you only want Telegram. Start `npm run dev` in terminal 1, then `npm run dev:worker` in terminal 2. Restart both whenever notification configuration changes.

#### C. Link each user's private Telegram chat

1. Sign in to AXIS and open **Notifications**.
2. Check that Telegram shows configured and polling has succeeded. The worker must be running.
3. Click **Get linking code**. The private, single-use code expires in ten minutes.
4. Open the exact bot username in a **private Telegram chat**, not a group.
5. Send the complete `/start …` command shown in AXIS.
6. Return to AXIS and click **Refresh channels and history**.
7. Select **Enable Telegram reminders**, check the authorization box, and click **Save notification preferences**. Linking by itself does not authorize delivery.
8. When ready to receive a real message, click **Send Telegram test** once. Check both Telegram and AXIS history.
9. Create a reminder a few minutes ahead, outside any quiet hours or focus block, and inspect the outcome.

Each user links their own chat. One chat cannot simultaneously belong to multiple AXIS accounts for the same bot. **Disconnect Telegram** or send `/stop` to revoke the link; dashboard disconnect records the revocation immediately in AXIS. The bot handles linking and opt-out, not general AI conversations.

**Sent to Telegram** means Telegram accepted the message and returned an ID; it is not a delivery or read receipt. An unknown result is not automatically resent. Inspect your chat before creating another send. Telegram's bot platform is currently free within its limits; this does not guarantee future pricing. AXIS disables paid broadcasting. See [Telegram details and troubleshooting](docs/telegram-setup.md).

### Step 7: Optional email notifications and fallback

Skip this section for Telegram-only operation. AXIS currently uses **Resend**, not Gmail SMTP. Google sign-in only proves the recipient's email; it does not grant permission to send mail from Gmail. Domain ownership, provider quotas and any associated costs are separate from AXIS.

#### A. Configure a sender

1. Create or sign in to your [Resend account](https://resend.com/).
2. In **Domains**, add a sending domain or subdomain you control, such as `notify.example.com`. Replace this example with your actual domain.
3. At your DNS provider, add the exact verification records Resend displays. Do not replace unrelated mail records. Wait until Resend reports the domain verified. See [Resend domain setup](https://resend.com/docs/dashboard/domains/introduction).
4. Choose a sender such as `axis@notify.example.com`. `EMAIL_FROM` must be a plain email address, not `AXIS <address>`.
5. Create an API key privately. AXIS sends email and retrieves message status, so ensure the key permits both operations; a send-only key can prevent reconciliation. Use the narrowest permission set Resend supports for those operations. See [Resend API key management](https://resend.com/docs/dashboard/api-keys/introduction).

#### B. Configure delivery callbacks

Resend must reach AXIS over HTTPS to report delivery outcomes. For local testing, use an explicitly chosen HTTPS forwarding setup that routes only the required webhook to the local API and preserves the raw body/signature headers. This guide does not provision a tunnel or publish the app. Telegram-only use requires none of this.

1. Obtain your approved external HTTPS origin, for example `https://your-notification-host.example`. `localhost` is not reachable from Resend.
2. Register a Resend webhook at `https://your-notification-host.example/webhooks/resend`.
3. Subscribe to `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.failed`, `email.complained` and `email.suppressed` where available in your dashboard.
4. Copy that webhook's signing secret privately; this is separate from the API key. AXIS verifies the signature. See [Resend webhooks](https://resend.com/docs/webhooks/introduction).
5. Update these entries in `.env`, replacing the examples:

```dotenv
NOTIFICATION_MODE=live
NOTIFICATION_PUBLIC_ORIGIN=https://your-notification-host.example
RESEND_API_KEY=REPLACE_WITH_YOUR_PRIVATE_API_KEY
EMAIL_FROM=axis@your-verified-domain.example
RESEND_WEBHOOK_SECRET=REPLACE_WITH_YOUR_PRIVATE_SIGNING_SECRET
```

Use only the HTTPS origin in `NOTIFICATION_PUBLIC_ORIGIN`, without a path. The real webhook signing secret starts with `whsec_`; the placeholder above will not work. Keep `APP_ORIGIN=http://localhost:3000` for local browser login. Changing the notification origin does not configure public Google sign-in or production hosting. The notification origin can also appear in reminder dashboard links; a webhook-only host will not provide a working public dashboard.

#### C. Enable and verify email in AXIS

1. Restart the API and worker after editing `.env`; keep the approved webhook forwarding process running if using one.
2. Sign out and sign back in with Google if **Notifications** says the email is unverified.
3. Check **Enable email to …**. The address is the current verified Google account address, not an arbitrary recipient.
4. To use email as a backup, also check **Use optional email fallback when sending to Telegram is unconfirmed**. Set the fallback delay; the existing default is 300 seconds.
5. Check the authorization box and save notification preferences.
6. Click **Send email test** once when ready for a real email. Inspect the inbox/spam folder, AXIS delivery history and Resend's event history.

Email enablement and fallback enablement are separate. A successful email test alone does not prove fallback works. Verify fallback separately with a controlled test reminder and consenting recipient. A confirmed Telegram send suppresses an unsent fallback. Uncertain outcomes can result in both channels arriving. Email **delivered** means the recipient mail server accepted it, not that a person read it.

---

## 5. Running the Application

### Option 1: Local Database and Application Launcher (Recommended)

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
>
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

   _Serves the backend and dashboard at `http://localhost:3000`._

2. **Terminal 2 — Background Reminder Worker:**

   ```powershell
   npm run dev:worker
   ```

   _Polls the database and manages reminder schedules and notification claims._

3. **Terminal 3 (Optional) — Frontend Vite Dev Server with Hot Module Reload (HMR):**

   ```powershell
   npm run dev --workspace @axis/web
   ```

   Vite proxies API/auth requests to port 3000. A separate browser origin also
   needs matching `APP_ORIGIN` and Google callback configuration; the default
   localhost:3000 authentication setup is not a ready-to-use port 5173 setup.
   Use the built dashboard on port 3000 for the supported quick start. Backend
   and frontend source are separate, but the default launcher serves the built
   frontend from the API process; it does not require a separate frontend server.

   For a deliberate three-terminal development setup, set `PORT=3000` and
   `APP_ORIGIN=http://localhost:5173` in `.env`, register
   `http://localhost:5173/auth/google/callback` in your Google OAuth client,
   restart the API and run the frontend with a fixed port:

   ```powershell
   npm run dev --workspace @axis/web -- --host localhost --port 5173 --strictPort
   ```

   Browse **http://localhost:5173** throughout that session. Vite forwards API,
   authentication and health requests to port 3000. Do not alternate browser
   origins during sign-in. To return to the default launcher, restore
   `APP_ORIGIN=http://localhost:3000`, retain the port-3000 Google callback,
   stop Vite and restart the API. This optional topology needs its own Google
   login check; automated browser results use the built dashboard.

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

Health checks confirm local process/database readiness, not successful Google,
Groq or messaging-provider calls. Complete sign-in and any explicitly authorized
provider checks separately.

### Worker Health

In a terminal, verify that the reminder worker is running and sending heartbeats:

```powershell
npm run worker:health
```

_(Exits with code 0 if the heartbeat is within 90 seconds and schema is ready)._

### First-run checklist

1. Open `http://localhost:3000/health/live` and `/health/ready`; both should return HTTP 200.
2. Sign in, open Settings and save your IANA timezone. Use `Asia/Kolkata` for India; `Asia/Calcutta` is an equivalent alias and may be displayed by the runtime.
3. Create a small test project and task. Refresh and confirm they remain.
4. If AI is enabled, load a model, save your own key and explicitly test the connection.
5. Run `npm run worker:health` and confirm readiness.
6. In mock mode, create a near-future reminder and inspect its simulated attempt history. Mock success does not send to Telegram or email.
7. If you enabled live channels, perform the explicitly requested channel test and near-future reminder check described above. Save your actual outcome; provider acceptance is not a read receipt.
8. For multiple users, sign in with a second verified Google account in a separate browser profile. Confirm it has its own workspace and no access to the first user's records or key. Each account must be allowed by your Google OAuth audience configuration.

Quiet hours and focus blocks defer reminders rather than delete them. On recovery
from downtime, the current policy sends one overdue occurrence and skips missed
repeats with a visible count. The worker cannot send while the computer is asleep,
off or disconnected. The API can stop without stopping the worker, but PostgreSQL
must remain available.

---

## 7. Testing & Code Quality

AXIS enforces strict code quality and test requirements:

| Command                      | Action                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run check`              | Runs full suite: Prettier format check, ESLint, TypeScript typecheck, and unit/security tests. |
| `npm test`                   | Runs all Node.js native unit and security test suites using `tsx --test`.                      |
| `npm run typecheck`          | Type-checks both backend and frontend TypeScript definitions (`tsc --noEmit`).                 |
| `npm run lint`               | Runs ESLint across all services, apps, and packages.                                           |
| `npm run format`             | Automatically formats all files using Prettier.                                                |
| `npm run test:integration`   | Runs integration tests against an isolated test database (requires `TEST_DATABASE_URL`).       |
| `npm run test:e2e`           | Runs Playwright browser-level end-to-end tests.                                                |
| `./scripts/verify-local.ps1` | Automated Windows PowerShell verification script.                                              |

For browser verification, build first and run
`powershell.exe -NoProfile -File scripts/verify-local.ps1 -Browser`.
The verification script expects this workspace's local cluster and private
`.local/pg-password` file for its test database role. That file is test tooling
configuration, not required by normal application startup. On a new machine,
configure isolated test databases following [the runbook](docs/runbook.md).
Never point integration tests at your development records or a production database.
See [M3 results](docs/m3-results.md) for actual test outcomes and pending live checks.
The latest [Groq change verification](docs/groq-model-results.md) records 33
unit/security, 63 database and 6 browser tests passing. These are recorded results,
not proof that your newly configured provider accounts work. This guide update
does not rerun live provider tests.

---

## 8. Stopping the Services

1. In the terminals running `npm run dev` and `npm run dev:worker`, press `Ctrl + C`.
   Stop the optional Vite and webhook forwarding processes too if you started them.
2. To cleanly stop the isolated PostgreSQL cluster:
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D .local/pgdata -m fast stop
   ```

Only stop this cluster after the API and worker are stopped. Do not delete
`.local/pgdata` to restart. The next daily start is `npm run dev` followed by
`npm run dev:worker` in a second terminal. If you use a system PostgreSQL service,
manage it through its normal service controls instead of this cluster command.

---

## 9. Common Troubleshooting

| Issue                                           | Cause & Resolution                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`UNAUTHENTICATED` / Setup Page shown**        | Google OAuth credentials are not configured in `.env`. Run `npm run setup:google` or edit `.env`.                                                                                                                  |
| **`redirect_uri_mismatch` during Google Login** | Ensure the authorized redirect URI in Google Cloud Console matches `http://localhost:3000/auth/google/callback` exactly.                                                                                           |
| **`DEPENDENCY_UNAVAILABLE` on `/health/ready`** | PostgreSQL is not running or migrations have not been applied. Run `npm run db:migrate`.                                                                                                                           |
| **AI requests fail with configuration error**   | Run `npm run setup:ai` to generate the server encryption key, restart the API server, then enter your Groq API key in **AI Settings** on the dashboard.                                                            |
| **Port 3000 already in use**                    | AXIS may already be running: open localhost:3000 and check health. Identify the process before stopping it; use Ctrl+C in its terminal if it is your earlier AXIS instance. Do not terminate an unrelated process. |
| **Worker reports no heartbeats**                | Make sure `npm run dev:worker` is running in an active terminal alongside the API server.                                                                                                                          |
| **`pwsh` is not recognized**                    | Current npm launchers use built-in `powershell.exe`. Run from this repository with its current package.json. PowerShell 7 is not required.                                                                         |
| **Notifications do not reach my phone/email**   | Mock mode intentionally simulates delivery. In live mode inspect provider readiness, saved channel consent and delivery history; see the M3 guide. Do not repeatedly resend an unknown outcome.                    |
| **Email enablement is unavailable**             | Sign out and sign in with Google again to record verified email evidence, then save notification consent.                                                                                                          |

| Additional symptom                              | What to do                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL executable not found                 | Confirm PostgreSQL 18 is installed. Set `$env:PG_BIN` to its binary directory for the launcher; use the actual binary path in manual setup commands.   |
| `initdb` says directory is not empty            | An existing cluster may already contain your records. Do not initialize or delete it; use its existing configuration.                                  |
| Database password rejected                      | Verify the dedicated role, port and URL-encoded password privately. Port 55432 is the project cluster; 5432 is commonly a system instance.             |
| Google allows one account but rejects another   | Check Google Auth Platform audience/test users. AXIS accepts verified Google accounts, but cannot bypass Google's project restrictions.                |
| Groq cannot serve the model                     | Load the current catalog, choose another text model, save and test. Check Groq project model permissions; a listed model may be restricted or retired. |
| Groq produces no text before its limit          | Choose another model or adjust `AI_MAX_OUTPUT_TOKENS` for chat and restart the API. Connection tests remain capped at 1,024.                           |
| Telegram code never links                       | Run the worker, use the exact bot/private chat and an unexpired code, then refresh. A different bot consumer or webhook can conflict with polling.     |
| Telegram test stays queued                      | Check saved consent, quiet hours/focus blocks, worker health and Telegram polling status.                                                              |
| Email stays accepted or unknown                 | Inspect Resend events, signed webhook reachability and API-key retrieval permissions. Do not treat acceptance as confirmed delivery.                   |
| Changes to `.env` have no effect                | Stop and restart the affected API and worker processes. Editing the file does not reload a running process.                                            |
| `npm run dev` succeeds but reminders do nothing | The launcher does not start the worker. Start `npm run dev:worker` separately.                                                                         |

## 10. Updating and preserving your data

### Reminder archive

The default Reminders view shows active items. Choose **Archive** in **Reminder
view** to inspect finished or cancelled reminders. They become eligible for
permanent deletion after seven days in Archive; keep the worker running for
cleanup. Pending or unknown delivery work delays deletion. Active recurring
reminders remain active. Migration 008 gives existing finished records a fresh
seven-day archive period. See [retention details](docs/reminder-archive.md).

### Create tasks and reminders through Chat

After updating, stop the API and worker, run `npm run dev` to apply migration 007,
then start `npm run dev:worker` separately. Set your timezone and Groq connection.
Ask “Create a task to read the proposal” or “Remind me tomorrow at 9 am to call
the supplier.” Review the draft and click **Confirm create task** or **Confirm
create reminder**. Only **Created** confirms that it was saved. Open Tasks or
Reminders to manage it. Dismiss incorrect drafts and ask again; confirmations
expire after 24 hours. See [chat creation details](docs/chat-actions.md).

### Update procedure

Before updating, securely back up the database and server encryption keyring
together. Keep `.env`, database backups and any Google credential downloads out of
source control and shared folders. A database backup without the encryption key
cannot recover stored Groq credentials. Do not rotate or regenerate keys as a
routine restart step. Rerunning `setup:google` generates a new session secret and
signs existing sessions out; `setup:ai` preserves an existing configured key.

For a code update:

1. Stop the API and worker.
2. Preserve the existing `.env` and database directory.
3. Run `npm ci` if dependencies changed.
4. Run `npm run dev` to apply pending migrations, rebuild and start the API; for an existing system database, use the individual commands in Section 5 instead.
5. Start `npm run dev:worker` in the second terminal.
6. Repeat the local health and basic UI checks.

This guide covers local operation. It does not configure an always-on host,
automatic service restart, public deployment or a tested backup/restore system.
Those require separate work. Current functionality includes private workspaces,
tasks/projects/memory, Groq text chat, durable reminders and Telegram with optional
email fallback. Calendar actions, general autonomous execution and later
milestones are not enabled by completing setup.
