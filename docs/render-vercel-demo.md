# Free AXIS demo: Vercel + Render

Prepared 2026-10-20. No cloud resource has been created or deployed by this change.
The owner selected a strictly free dashboard/API demo, without background workers.
Use synthetic testing records and a new database.

## What works and what does not

Vercel serves the React dashboard. Requests to `/auth/*` and `/api/*` are proxied
to Render under the same public Vercel address. Render runs Express and migrations.
Neon Free is the proposed PostgreSQL host: Render's free database expires after
30 days. Neon has storage/compute limits; verify the current Free plan when signing up.

Tasks, projects, memory, approvals, ordinary chat and manually refreshed planning/
Calendar remain available subject to their existing setup. AI calls use each user's
own key and may consume that provider's quota; free hosting does not make AI free.

There is no reminder worker or agent worker. Reminder records can be saved and
edited but are not delivered. Proactive alerts, Telegram linking/polling, scheduled
archive cleanup and delegated runs are unavailable. The dashboard states these
limits; delegated submissions are rejected by the API. Demo workers refuse startup.
NOTIFICATION_MODE must remain mock. No production reliability is claimed.

Render Free sleeps after inactivity and can take about a minute to wake. The first
Vercel request can time out while Render wakes: open the Render health URL, wait,
then reload the dashboard. No keep-alive service is configured.

## 1. Put the code in a private Git repository

Use your existing GitHub repository or create a private one. Review the files
before pushing. Do not include `.env`, `.local`, OAuth JSON downloads, database
files, backup artifacts or SSH keys. `.gitignore` excludes common secret files.
Review repository history too if it has ever contained credentials.

The host needs the whole monorepo, not only `apps/web`. Deployment commands run
from the repository root. Node 24 is required.

## 2. Create a fresh free PostgreSQL database

1. Sign up at <https://neon.com/> and choose **Free**, not a paid upgrade.
2. Create a dedicated project/database for AXIS demo; choose PostgreSQL 18 if
   available and a region near the Render service.
3. Copy its **direct/unpooled** PostgreSQL connection string privately into
   Render's DATABASE_URL field in step 4. Preserve the provider's TLS parameters.
   Never disable certificate verification to work around an error.
4. Use a new empty database so startup migrations create the schema. Do not copy
   your local personal database into this demo.

Direct connections are selected because migrations use PostgreSQL advisory locks.
The API/session pools are small, but free database quotas still apply. Check
Neon's dashboard for usage. Existing short connection timeouts can produce a
temporary readiness failure during database wake-up; retry after it wakes.

## 3. Create the Vercel frontend project

1. Import the Git repository into Vercel with the **Hobby** plan, subject to its
   personal/non-commercial usage terms.
2. Leave **Root Directory** at the repository root.
3. Select **Vite**. The included `vercel.json` specifies:
   - Install: `npm ci`
   - Build: `npm run build`
   - Output: `apps/web/dist`
4. Select Node **24.x** in project settings.
5. Deploy to obtain a stable production address such as
   `https://your-axis-demo.vercel.app`.

At this point API/login will not work: `vercel.json` intentionally contains
`axis-api-replace-me.onrender.com`. It must be replaced in step 5.
Do not enter database passwords, OAuth secrets or encryption keys into Vercel.
Never put secrets in `VITE_*` variables.

Use the stable production Vercel URL, not a different preview URL for each commit.
The single configured origin must match Google callbacks and browser CSRF checks.

## 4. Create the free Render API

Import `render.yaml` through **New → Blueprint**, or create a **Web Service**
manually with the settings below. Review the plan before confirming. The blueprint
creates one free web service only; it does not create paid workers or a database.

| Setting        | Value                                       |
| -------------- | ------------------------------------------- |
| Runtime        | Node                                        |
| Root directory | Repository root                             |
| Plan           | Free                                        |
| Build command  | `npm ci --include=dev && npm run typecheck` |
| Start command  | `npm run start:demo`                        |
| Health check   | `/health/ready`                             |

Set these server environment values:

| Name                          | Value                                               |
| ----------------------------- | --------------------------------------------------- |
| NODE_VERSION                  | `24`                                                |
| NODE_ENV                      | `production`                                        |
| HOST                          | `0.0.0.0`                                           |
| TRUST_PROXY_HOPS              | `1`                                                 |
| DEMO_MODE                     | `true`                                              |
| NOTIFICATION_MODE             | `mock`                                              |
| DATABASE_URL                  | Private direct Neon URL, including TLS parameters   |
| APP_ORIGIN                    | Exact stable Vercel HTTPS origin, no trailing slash |
| GOOGLE_CLIENT_ID              | Google web OAuth client ID                          |
| GOOGLE_CLIENT_SECRET          | Corresponding secret                                |
| SESSION_SECRET                | New random secret, at least 48 characters           |
| AI_CREDENTIALS_ENCRYPTION_KEY | New random 32-byte base64 key                       |
| AI_CREDENTIALS_KEY_VERSION    | `v1`                                                |

Render supplies PORT; do not hard-code port 3000. Keep proxy trust disabled locally.
Trusting one hop is for Render's ingress, which must supply the forwarding headers;
do not enable it for an arbitrary directly exposed server.

For a new demo, generate each secret locally using a password manager or these
commands. Copy the output only into the intended private field, not chat, source
files, screenshots or a shared terminal:

```powershell
# SESSION_SECRET
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
# AI_CREDENTIALS_ENCRYPTION_KEY
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Store a secure recovery copy. Do not regenerate the encryption key on redeploy:
existing stored user keys/Calendar credentials would become unreadable.
Do not configure Telegram, email, Twilio or backup secrets for this demo.

Deploy the API. `start:demo` runs migrations before starting the API. Free Render
does not require a paid pre-deploy job for this approach. It uses normal migration
locking, not database reset. Keep the service at one instance.

## 5. Connect frontend to backend

Copy the Render service URL. Edit the **two** destinations in root `vercel.json`,
replacing only:

```text
https://axis-api-replace-me.onrender.com
```

with your actual Render HTTPS origin. Preserve `/api/:path*` and `/auth/:path*`.
Commit/push that change and redeploy Vercel. The actual backend URL is configuration,
not a credential. A VITE_API_URL is unnecessary: browser requests stay same-origin.

Check:

1. `https://YOUR-RENDER-HOST/health/ready` should return `{"status":"ready"}`.
2. `https://YOUR-VERCEL-HOST/auth/status` should return configured true and demoMode true.
3. The Vercel homepage should load. If Render is cold, wait for step 1 and reload.

No CORS wildcard or cross-site session cookie is needed. Cookies remain HttpOnly,
Secure and SameSite=Lax. API/auth responses are not cached. Live proxy behavior
must still be verified after deployment.

## 6. Configure Google for the public address

In the selected Google web OAuth client, add these **Authorized redirect URIs**:

```text
https://YOUR-VERCEL-HOST/auth/google/callback
https://YOUR-VERCEL-HOST/api/v1/calendar/callback
```

Keep localhost callbacks if you still develop locally. Do not use the Render
hostname for these callbacks. APP_ORIGIN must match the Vercel origin exactly.
Use a separate test OAuth client if you want isolation from local credentials.

Enable Calendar API and add `calendar.events.readonly` only if testing Calendar.
For Google apps in Testing, add every intended tester to the test-user list.
Calendar connections remain subject to Google's testing token lifetime rules.

## 7. Verify the hosted demo before sharing

- Sign in, reload, confirm the session remains active, then test logout.
- Create/edit a synthetic task; check persistence after API redeploy.
- Use two browser profiles/accounts and confirm private records stay separate.
- Confirm the demo notice appears; delegated runs must return DEMO_UNAVAILABLE.
- Check requests through Vercel for CSRF failures or insecure/missing cookies.
- If desired, test ordinary chat using your own key and explicit quota consent.
- Calendar connection and refresh require explicit Google consent.
- Confirm no worker or live notification provider is configured.
- Check cold-start behavior after idle time and database quota usage.

These hosted checks have not been executed. A local mock test cannot establish
Vercel-to-Render cookie forwarding or real OAuth acceptance.

## Operations and limitations

Render's filesystem is ephemeral. Do not store backups or the only copy of keys
there. The M6 local restore tools require local PostgreSQL privileges; they are not
an automated Neon recovery service. A cloud backup/recovery plan remains separate.
Free-tier limits can change. This configuration is a disposable demo, not an
always-on personal reminder service.

## References

- [Render free limits](https://render.com/docs/free)
- [Render worker plan availability](https://render.com/docs/compute-plans)
- [Render port binding](https://render.com/docs/web-services#port-binding)
- [Vercel reverse proxy rewrites](https://vercel.com/kb/guide/vercel-reverse-proxy-rewrites-external)
- [Neon pricing](https://neon.com/pricing)
- [Vercel Hobby usage](https://vercel.com/docs/plans/hobby)

## Verification results

- `npm run check`: formatting, lint and type checks passed; 48 unit/security
  tests passed. Includes strict host/proxy settings, demo status, rejection of
  live notifications and actual worker-process refusal in demo mode.
- `./scripts/verify-local.ps1`: 110 integration tests passed using disposable
  database `axis_test_f2e83fd0e689`. New coverage checks secure cookies behind a
  simulated HTTPS proxy, default distrust of forwarded headers, persisted login,
  CSRF enforcement and authenticated demo restrictions.
- `npm run build`: passed.
- `./scripts/verify-local.ps1 -Browser`: all 10 browser tests passed against
  `axis_test_e2e_d457da23f44d`, including the demo notice across navigation.
  This notice test supplies demo status through a mocked HTTP response; backend
  restrictions are covered separately by integration/process tests. Existing
  non-demo features were exercised by the rest of the browser suite.

No hosted deployment has been verified. The Render/Vercel descriptors remain
templates until the actual URLs and private environment values are configured.
There is no schema change. No dependencies were added.
