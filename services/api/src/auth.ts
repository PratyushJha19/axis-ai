import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { sql, type Kysely } from "kysely";
import * as oidc from "openid-client";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Database } from "../../../packages/database/src/index.js";
import type { Profile } from "../../../packages/shared/src/contracts.js";
import { DomainError } from "../../../packages/domain/src/errors.js";
import { audit } from "../../../packages/domain/src/records.js";

interface Challenge {
  state: string;
  verifier: string;
  nonce: string;
}
export interface IdentityProvider {
  begin(): Promise<{ url: string; challenge: Challenge }>;
  verify(
    url: URL,
    challenge: Challenge,
  ): Promise<{
    subject: string;
    email: string;
    verified: boolean;
    name: string;
  }>;
}
export interface AuthConfig {
  origin: string;
  secret: string;
  clientId: string;
  clientSecret: string;
}
declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrf?: string;
    authExpiresAt?: number;
    oauth?: Challenge;
  }
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig | undefined {
  const keys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET"];
  if (!keys.some((key) => env[key])) return undefined;
  const parsed = z
    .object({
      GOOGLE_CLIENT_ID: z.string().min(1),
      GOOGLE_CLIENT_SECRET: z.string().min(1),
      SESSION_SECRET: z.string().min(48),
      APP_ORIGIN: z.url(),
    })
    .safeParse({
      ...env,
      APP_ORIGIN: env.APP_ORIGIN || "http://localhost:3000",
    });
  if (!parsed.success)
    throw new Error("Incomplete authentication configuration.");
  const value = parsed.data;
  const origin = new URL(value.APP_ORIGIN);
  if (
    origin.origin !== value.APP_ORIGIN ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      ))
  )
    throw new Error("Invalid application origin.");
  return {
    origin: origin.origin,
    secret: value.SESSION_SECRET,
    clientId: value.GOOGLE_CLIENT_ID,
    clientSecret: value.GOOGLE_CLIENT_SECRET,
  };
}

export function googleProvider(config: AuthConfig): IdentityProvider {
  let discovery: Promise<oidc.Configuration> | undefined;
  const getConfiguration = () =>
    (discovery ??= oidc
      .discovery(
        new URL("https://accounts.google.com"),
        config.clientId,
        config.clientSecret,
        undefined,
        { timeout: 10 },
      )
      .catch((error) => {
        discovery = undefined;
        throw error;
      }));
  return {
    async begin() {
      const configuration = await getConfiguration();
      const challenge = {
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
        verifier: oidc.randomPKCECodeVerifier(),
      };
      const url = oidc.buildAuthorizationUrl(configuration, {
        redirect_uri: `${config.origin}/auth/google/callback`,
        scope: "openid email profile",
        code_challenge: await oidc.calculatePKCECodeChallenge(
          challenge.verifier,
        ),
        code_challenge_method: "S256",
        state: challenge.state,
        nonce: challenge.nonce,
        prompt: "select_account",
      });
      return { url: url.href, challenge };
    },
    async verify(url, challenge) {
      const tokens = await oidc.authorizationCodeGrant(
        await getConfiguration(),
        url,
        {
          pkceCodeVerifier: challenge.verifier,
          expectedState: challenge.state,
          expectedNonce: challenge.nonce,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      if (
        !claims ||
        typeof claims.sub !== "string" ||
        typeof claims.email !== "string"
      )
        throw new Error("Invalid identity");
      return {
        subject: claims.sub,
        email: claims.email,
        verified: claims.email_verified === true,
        name: typeof claims.name === "string" ? claims.name : "AXIS user",
      };
    },
  };
}

const hash = (state: string) =>
  createHash("sha256").update(state).digest("hex");
const sessionSave = (req: Express.Request & { session: session.Session }) =>
  new Promise<void>((resolve, reject) =>
    req.session.save((error) => (error ? reject(error) : resolve())),
  );

export function createAuth(
  db: Kysely<Database>,
  connectionString: string,
  config: AuthConfig,
  provider: IdentityProvider = googleProvider(config),
) {
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 2000,
    statement_timeout: 3000,
  });
  pool.on("error", () => undefined); // Request middleware reports a sanitized failure; never serialize driver errors.
  const Store = connectPgSimple(session);
  const store = new Store({
    pool,
    tableName: "sessions",
    createTableIfMissing: false,
    disableTouch: true,
    pruneSessionInterval: false,
    errorLog: () => undefined,
  });
  const middleware = session({
    store,
    name: "axis.sid",
    secret: config.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.origin.startsWith("https:"),
      maxAge: 86400000,
      path: "/",
    },
  });
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(
          new DomainError(
            "RATE_LIMITED",
            429,
            "Too many sign-in attempts. Try again later.",
          ),
        ),
    }),
  );
  router.get("/google", async (req, res) => {
    const { url, challenge } = await provider.begin();
    await sql`delete from oauth_challenges where expires_at < now()`.execute(
      db,
    );
    await sql`insert into oauth_challenges(state_hash,expires_at) values (${hash(challenge.state)},now()+interval '10 minutes')`.execute(
      db,
    );
    req.session.oauth = challenge;
    await sessionSave(req);
    res.redirect(url);
  });
  router.get("/google/callback", async (req, res) => {
    try {
      const challenge = req.session.oauth;
      if (!challenge || req.query.state !== challenge.state)
        throw new Error("Invalid state");
      delete req.session.oauth;
      await sessionSave(req);
      const consumed =
        await sql`delete from oauth_challenges where state_hash=${hash(challenge.state)} and expires_at>now() returning state_hash`.execute(
          db,
        );
      if (!consumed.rows.length) throw new Error("Expired challenge");
      const identity = z
        .object({
          subject: z.string().min(1).max(255),
          email: z.email().max(320),
          verified: z.literal(true),
          name: z.string().max(1000),
        })
        .parse(
          await provider.verify(
            new URL(req.originalUrl, config.origin),
            challenge,
          ),
        );
      const userId = await db.transaction().execute(async (trx) => {
        // Google subject is the immutable identity. Email is mutable metadata,
        // never an account-linking key. The unique constraint serializes enrollment.
        const result = await sql<{
          id: string;
        }>`insert into users(id,google_subject,email,display_name,email_verified_at) values (${randomUUID()},${identity.subject},${identity.email.toLowerCase()},${identity.name.trim().slice(0, 120) || "AXIS user"},now()) on conflict(google_subject) do update set email=excluded.email,email_verified_at=now(),updated_at=now() returning id`.execute(
          trx,
        );
        return result.rows[0]!.id;
      });
      await new Promise<void>((resolve, reject) =>
        req.session.regenerate((error) => (error ? reject(error) : resolve())),
      );
      await audit(db, userId, "login_succeeded", null, res.locals.requestId);
      req.session.userId = userId;
      req.session.csrf = randomBytes(32).toString("hex");
      req.session.authExpiresAt = Date.now() + 86400000;
      await sessionSave(req);
      res.redirect("/");
    } catch {
      res.redirect("/?login=failed");
    }
  });
  const protect: RequestHandler = async (req, res, next) => {
    if (
      !req.session?.userId ||
      !req.session.authExpiresAt ||
      req.session.authExpiresAt <= Date.now()
    )
      return next(
        new DomainError("UNAUTHENTICATED", 401, "Sign in to continue."),
      );
    const users =
      await sql<Profile>`select id,email,display_name,timezone from users where id=${req.session.userId}`.execute(
        db,
      );
    if (!users.rows[0])
      return next(
        new DomainError("UNAUTHENTICATED", 401, "Sign in to continue."),
      );
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("origin") !== config.origin ||
        !req.session.csrf ||
        req.get("x-csrf-token") !== req.session.csrf)
    )
      return next(
        new DomainError(
          "FORBIDDEN",
          403,
          "Request verification failed. Refresh and try again.",
        ),
      );
    res.locals.user = users.rows[0];
    next();
  };
  return { middleware, router, protect, close: () => pool.end() };
}
export type Auth = ReturnType<typeof createAuth>;
