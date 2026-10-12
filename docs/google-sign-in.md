# Google sign-in for local AXIS

M1 uses Google for identity only, with scopes `openid email profile`. It does not
request Gmail, Drive or Calendar access. No Google credentials are bundled or
created by the application. Never paste client secrets into chat or source files.

## Application setup

The Windows npm launchers use built-in Windows PowerShell (`powershell.exe`);
PowerShell 7 (`pwsh`) is not required.

1. In [Google Cloud Console](https://console.cloud.google.com/), select your own
   project and configure Google Auth Platform branding/audience. For an external
   app in testing mode, ensure the Google audience/test-user configuration permits the accounts you want to test. AXIS itself now admits any verified Google account; Google can still impose its own audience restrictions.
2. Create an OAuth client of type **Web application**. Add this exact authorized
   redirect URI: `http://localhost:3000/auth/google/callback`. Do not enable extra
   API scopes or billable services for sign-in.
3. Run `npm run setup:google` locally. It asks for the client ID and
   hidden client secret, generates a session signing secret, and updates only the
   auth settings in ignored `.env`. Existing database settings are preserved.
   Alternatively, edit `.env` yourself and keep its DATABASE_URL. Add:

   ```dotenv
   APP_ORIGIN=http://localhost:3000
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   SESSION_SECRET=
   ```

   Fill the Google values privately. OWNER_EMAIL is obsolete and ignored if it remains in an existing .env. Set SESSION_SECRET to at least 48 random
   characters. Generate it locally using a password manager or cryptographic random
   generator; do not reuse a password or commit it. These values are server-only.

4. Run `npm run dev` to start the existing local cluster, migrate, build and launch
   the app. Open **http://localhost:3000**, rather than switching between
   localhost and 127.0.0.1 (cookies and OAuth redirect origins must match).
5. Click **Continue with Google**. Any verified Google account can create a private workspace. A returning account is identified by its Google subject, not its email. Existing accounts keep their records. Unverified claims are denied; a different Google subject never inherits another account's workspace even if its email matches.
6. Confirm your timezone in Settings. It is not silently inferred into your profile.

If all auth values are absent, AXIS displays the setup page and denies private API
access. If configuration is partly filled or invalid, startup fails closed with a
generic configuration error. Restart the API after editing `.env`.

## Manual acceptance still required

- Real Google consent, redirect and two distinct account logins succeed, using separate browser profiles/private windows.
- Each account sees only its own records and AI settings; each supplies its own provider key.
- Refresh and API restart preserve the session; Sign out invalidates it.
- Do not expose this local installation publicly. HTTP cookies are allowed only
  for loopback development; HTTPS sets Secure cookies. Production reverse-proxy
  trust, TLS termination and hosting need separate review before deployment.

Sessions are stored in PostgreSQL and have a fixed 24-hour authentication deadline.
Tokens from Google are not stored. A new Google sign-in is required after expiry.
The OAuth state is consumed atomically and expires after ten minutes; the callback
also verifies PKCE and nonce through openid-client. Sign-out deletes the session.
Changing the session signing secret invalidates existing cookies. Email changes do not transfer ownership. The original owner binding is retained as historical data but no longer gates authentication. No user directory, shared workspace or administrative access to another user's records is exposed.

References: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[openid-client code exchange](https://github.com/panva/openid-client/blob/main/docs/functions/authorizationCodeGrant.md),
[Express sessions](https://expressjs.com/en/resources/middleware/session/).
