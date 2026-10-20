import * as oidc from "openid-client";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "../../shared/src/calendar.js";
export const calendarScope =
  "https://www.googleapis.com/auth/calendar.events.readonly";
export interface CalendarChallenge {
  state: string;
  verifier: string;
  nonce: string;
}
export interface CalendarGrant {
  subject: string;
  refresh: string;
  scopes: string[];
}
export interface CalendarProvider {
  begin(): Promise<{ url: string; challenge: CalendarChallenge }>;
  exchange(url: URL, challenge: CalendarChallenge): Promise<CalendarGrant>;
  events(refresh: string, start: string, end: string): Promise<CalendarEvent[]>;
  revoke(refresh: string): Promise<boolean>;
}
export class CalendarFailure extends Error {
  constructor(
    readonly code:
      | "reauthorize"
      | "rate_limited"
      | "provider_failure"
      | "too_many_events"
      | "invalid_events",
  ) {
    super(code);
  }
}
const boundary = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});
const item = z.object({
  id: z.string().min(1).max(1024),
  status: z.string().optional(),
  summary: z.string().max(10000).optional(),
  transparency: z.string().optional(),
  start: boundary.optional(),
  end: boundary.optional(),
});
export function normalizeCalendarPage(raw: unknown) {
  const page = z
    .object({
      timeZone: z.string(),
      nextPageToken: z.string().max(4096).optional(),
      items: z.array(item).max(250),
    })
    .parse(raw);
  const events: CalendarEvent[] = [];
  for (const e of page.items) {
    if (e.status === "cancelled") continue;
    if (!e.start || !e.end) throw new CalendarFailure("invalid_events");
    const timezone = e.start.timeZone || page.timeZone;
    Temporal.PlainDate.from("2000-01-01").toZonedDateTime(timezone);
    const instant = (b: z.infer<typeof boundary>) =>
      b.date
        ? Temporal.PlainDate.from(b.date)
            .toZonedDateTime(b.timeZone || page.timeZone)
            .toInstant()
            .toString()
        : b.dateTime
          ? (() => {
              try {
                return Temporal.Instant.from(b.dateTime).toString();
              } catch {
                return Temporal.PlainDateTime.from(b.dateTime)
                  .toZonedDateTime(b.timeZone || page.timeZone, {
                    disambiguation: "reject",
                  })
                  .toInstant()
                  .toString();
              }
            })()
          : (() => {
              throw new CalendarFailure("invalid_events");
            })();
    const start = instant(e.start),
      end = instant(e.end);
    if (
      Date.parse(end) <= Date.parse(start) ||
      Boolean(e.start.date) !== Boolean(e.end.date)
    )
      throw new CalendarFailure("invalid_events");
    events.push({
      id: e.id,
      title: (e.summary || "Busy commitment").slice(0, 300),
      start,
      end,
      timezone,
      all_day: Boolean(e.start.date),
      busy: e.transparency !== "transparent",
    });
  }
  return { events, next: page.nextPageToken };
}
export function googleCalendarProvider(
  config: { origin: string; clientId: string; clientSecret: string },
  fetcher: typeof fetch = fetch,
): CalendarProvider {
  let discovery: Promise<oidc.Configuration> | undefined;
  const settings = () =>
    (discovery ??= oidc
      .discovery(
        new URL("https://accounts.google.com"),
        config.clientId,
        config.clientSecret,
        undefined,
        { timeout: 10 },
      )
      .catch((e) => {
        discovery = undefined;
        throw e;
      }));
  const redirect = `${config.origin}/api/v1/calendar/callback`;
  async function json(url: string | URL, init: RequestInit) {
    const r = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok)
      throw new CalendarFailure(
        [400, 401, 403].includes(r.status)
          ? "reauthorize"
          : r.status === 429
            ? "rate_limited"
            : "provider_failure",
      );
    const reader = r.body?.getReader();
    if (!reader) throw new CalendarFailure("provider_failure");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 2_000_000) throw new CalendarFailure("too_many_events");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  }
  return {
    async begin() {
      const challenge = {
        state: oidc.randomState(),
        verifier: oidc.randomPKCECodeVerifier(),
        nonce: oidc.randomNonce(),
      };
      const url = oidc.buildAuthorizationUrl(await settings(), {
        redirect_uri: redirect,
        scope: `openid email ${calendarScope}`,
        state: challenge.state,
        nonce: challenge.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(
          challenge.verifier,
        ),
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "false",
      });
      return { url: url.href, challenge };
    },
    async exchange(url, challenge) {
      const tokens = await oidc.authorizationCodeGrant(await settings(), url, {
        expectedState: challenge.state,
        expectedNonce: challenge.nonce,
        pkceCodeVerifier: challenge.verifier,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (
        !claims?.sub ||
        claims.email_verified !== true ||
        !tokens.refresh_token ||
        !tokens.scope?.split(" ").includes(calendarScope)
      )
        throw new CalendarFailure("reauthorize");
      return {
        subject: claims.sub,
        refresh: tokens.refresh_token,
        scopes: tokens.scope.split(" "),
      };
    },
    async events(refresh, start, end) {
      const token = z
        .object({
          access_token: z.string().min(1),
          scope: z.string().optional(),
        })
        .parse(
          await json("https://oauth2.googleapis.com/token", {
            method: "POST",
            body: new URLSearchParams({
              client_id: config.clientId,
              client_secret: config.clientSecret,
              refresh_token: refresh,
              grant_type: "refresh_token",
            }),
          }),
        );
      if (token.scope && !token.scope.split(" ").includes(calendarScope))
        throw new CalendarFailure("reauthorize");
      const events = new Map<string, CalendarEvent>();
      let next: string | undefined;
      for (let count = 0; count < 10; count++) {
        const url = new URL(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        );
        url.search = new URLSearchParams({
          timeMin: start,
          timeMax: end,
          singleEvents: "true",
          showDeleted: "false",
          maxResults: "250",
          fields:
            "timeZone,nextPageToken,items(id,status,summary,start,end,transparency)",
          ...(next ? { pageToken: next } : {}),
        }).toString();
        const page = normalizeCalendarPage(
          await json(url, {
            headers: { Authorization: `Bearer ${token.access_token}` },
          }),
        );
        for (const e of page.events) events.set(e.id, e);
        next = page.next;
        if (!next) return [...events.values()];
      }
      throw new CalendarFailure("too_many_events");
    },
    async revoke(refresh) {
      try {
        const r = await fetcher("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          body: new URLSearchParams({ token: refresh }),
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        return r.ok;
      } catch {
        return false;
      }
    },
  };
}
