import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../database/src/index.js";
import type { CalendarEvent, CalendarView } from "../../shared/src/calendar.js";
import { KeyVault, type Envelope } from "./ai-crypto.js";
import {
  CalendarFailure,
  calendarScope,
  type CalendarChallenge,
  type CalendarProvider,
} from "./calendar-provider.js";
import { DomainError } from "./errors.js";
import { audit } from "./records.js";
import { dayRange } from "./planning-engine.js";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const purpose = "google-calendar";
interface Connection {
  revision: string;
  credential: Envelope | null;
  subject: string;
  status: string;
  events: CalendarEvent[];
  range_start: Date | null;
  range_end: Date | null;
  last_sync: Date | null;
  retry_at: Date | null;
  lease_until: Date | null;
  error_code: string | null;
}
export class CalendarService {
  constructor(
    readonly db: Kysely<Database>,
    readonly runtime?: { vault: KeyVault; provider: CalendarProvider },
    readonly now: () => Date = () => new Date(),
  ) {}
  async connection(user: string) {
    return (
      await sql<Connection>`select * from calendar_connections where user_id=${user}`.execute(
        this.db,
      )
    ).rows[0];
  }
  async view(user: string, start?: Date, end?: Date): Promise<CalendarView> {
    const c = await this.connection(user);
    const events = c?.events ?? [];
    const stale = !c?.last_sync || +this.now() - +c.last_sync > 300000;
    const covered =
      c?.range_start &&
      c.range_end &&
      (!start || +c.range_start <= +start) &&
      (!end || +c.range_end >= +end);
    const warning =
      !c || c.status === "disconnected"
        ? "Calendar is not connected; using AXIS availability only."
        : c.status === "reauthorize"
          ? "Calendar needs reconnection. Cached commitments may be outdated."
          : stale || !covered || c.status !== "connected"
            ? "Calendar data is stale, unavailable or outside the refreshed range. Refresh before relying on this plan."
            : null;
    return {
      configured: Boolean(this.runtime),
      status: c?.status ?? "disconnected",
      last_sync: c?.last_sync?.toISOString() ?? null,
      range_start: c?.range_start?.toISOString() ?? null,
      range_end: c?.range_end?.toISOString() ?? null,
      warning,
      error_code: c?.error_code ?? null,
      events: events.filter(
        (e) =>
          (!start || Date.parse(e.end) > +start) &&
          (!end || Date.parse(e.start) < +end),
      ),
    };
  }
  requireRuntime() {
    if (!this.runtime)
      throw new DomainError(
        "CALENDAR_DISABLED",
        503,
        "Calendar requires Google configuration and the server encryption key.",
      );
    return this.runtime;
  }
  async begin(user: string, session: string) {
    const { provider, vault } = this.requireRuntime();
    const { url, challenge } = await provider.begin();
    const revision = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await sql`select id from users where id=${user} for update`.execute(trx);
      await sql`delete from calendar_challenges where user_id=${user} or expires_at<${this.now()}`.execute(
        trx,
      );
      await sql`insert into calendar_connections(user_id,revision,subject,scopes,status) values(${user},${revision},'',array[]::text[],'disconnected') on conflict(user_id) do update set revision=excluded.revision,lease=null,lease_until=null`.execute(
        trx,
      );
      const encrypted = vault.encrypt(
        JSON.stringify({ ...challenge, revision }),
        user,
        "calendar-oauth",
      );
      await sql`insert into calendar_challenges(state_hash,user_id,session_hash,challenge,expires_at) values(${hash(challenge.state)},${user},${hash(session)},${JSON.stringify(encrypted)}::jsonb,${new Date(+this.now() + 600000)})`.execute(
        trx,
      );
    });
    return { url };
  }
  async callback(user: string, session: string, url: URL, correlation: string) {
    const { provider, vault } = this.requireRuntime();
    const state = url.searchParams.get("state");
    if (!state || state.length > 1024)
      throw new DomainError(
        "CALENDAR_STATE",
        400,
        "Calendar connection expired or could not be verified. Start again.",
      );
    const row = (
      await sql<{
        challenge: Envelope;
      }>`delete from calendar_challenges where state_hash=${hash(state)} and user_id=${user} and session_hash=${hash(session)} and expires_at>${this.now()} returning challenge`.execute(
        this.db,
      )
    ).rows[0];
    if (!row)
      throw new DomainError(
        "CALENDAR_STATE",
        400,
        "Calendar connection expired or could not be verified. Start again.",
      );
    const challenge = JSON.parse(
      vault.decrypt(row.challenge, user, "calendar-oauth"),
    ) as CalendarChallenge & { revision: string };
    const grant = await provider.exchange(url, challenge);
    if (!grant.refresh || !grant.scopes.includes(calendarScope))
      throw new CalendarFailure("reauthorize");
    await this.db.transaction().execute(async (trx) => {
      const identity = (
        await sql<{
          google_subject: string;
        }>`select google_subject from users where id=${user} for update`.execute(
          trx,
        )
      ).rows[0];
      if (identity?.google_subject !== grant.subject)
        throw new DomainError(
          "CALENDAR_ACCOUNT",
          403,
          "Connect the same Google account used to sign in to AXIS.",
        );
      const credential = vault.encrypt(grant.refresh, user, purpose);
      const result =
        await sql`update calendar_connections set credential=${JSON.stringify(credential)}::jsonb,subject=${grant.subject},scopes=${grant.scopes},status='connected',events='[]',last_sync=null,range_start=null,range_end=null,error_code=null,retry_at=null,updated_at=now() where user_id=${user} and revision=${challenge.revision} returning user_id`.execute(
          trx,
        );
      if (!result.rows.length)
        throw new DomainError(
          "CALENDAR_STATE",
          409,
          "Connection was cancelled. Start again.",
        );
      await audit(trx, user, "calendar_connected", null, correlation);
    });
  }
  async sync(user: string, date: string, days: number, correlation: string) {
    const { provider, vault } = this.requireRuntime();
    const p = (
      await sql<{
        timezone: string | null;
      }>`select timezone from users where id=${user}`.execute(this.db)
    ).rows[0];
    if (!p?.timezone)
      throw new DomainError(
        "TIMEZONE_REQUIRED",
        422,
        "Set your profile timezone first.",
      );
    const range = dayRange(date, p.timezone, days),
      lease = randomUUID(),
      now = this.now();
    const row = (
      await sql<Connection>`update calendar_connections set lease=${lease},lease_until=${new Date(+now + 120000)},status='syncing',last_attempt=${now} where user_id=${user} and credential is not null and status<>'reauthorize' and (lease_until is null or lease_until<${now}) and (retry_at is null or retry_at<=${now}) returning *`.execute(
        this.db,
      )
    ).rows[0];
    if (!row?.credential)
      throw new DomainError(
        "CALENDAR_WAIT",
        409,
        "Connect Calendar or wait for the current refresh/cooldown before trying again.",
      );
    try {
      const events = await provider.events(
        vault.decrypt(row.credential, user, purpose),
        range.start.toISOString(),
        range.end.toISOString(),
      );
      await this.db.transaction().execute(async (trx) => {
        await sql`select id from users where id=${user} for update`.execute(
          trx,
        );
        await sql`update calendar_connections set events=${JSON.stringify(events)}::jsonb,range_start=${range.start},range_end=${range.end},last_sync=${this.now()},status='connected',error_code=null,lease=null,lease_until=null,retry_at=${new Date(+this.now() + 30000)} where user_id=${user} and revision=${row.revision} and lease=${lease}`.execute(
          trx,
        );
        await audit(trx, user, "calendar_refresh_finished", null, correlation);
      });
    } catch (e) {
      const code = e instanceof CalendarFailure ? e.code : "provider_failure";
      await sql`update calendar_connections set status=${code === "reauthorize" ? "reauthorize" : "temporary_failure"},error_code=${code},lease=null,lease_until=null,retry_at=${new Date(+this.now() + 300000)} where user_id=${user} and revision=${row.revision} and lease=${lease}`.execute(
        this.db,
      );
    }
    return this.view(user, range.start, range.end);
  }
  async disconnect(user: string, correlation: string) {
    const c = await this.db.transaction().execute(async (trx) => {
      await sql`select id from users where id=${user} for update`.execute(trx);
      const c = await new CalendarService(trx).connection(user);
      await sql`delete from calendar_challenges where user_id=${user}`.execute(
        trx,
      );
      await sql`update calendar_connections set revision=${randomUUID()},credential=null,events='[]',status='disconnected',last_sync=null,range_start=null,range_end=null,lease=null,lease_until=null,retry_at=null,error_code=null where user_id=${user}`.execute(
        trx,
      );
      await audit(trx, user, "calendar_disconnected", null, correlation);
      return c;
    });
    let revoked = false;
    if (c?.credential && this.runtime)
      try {
        revoked = await this.runtime.provider.revoke(
          this.runtime.vault.decrypt(c.credential, user, purpose),
        );
      } catch {
        /* Local deletion is authoritative even if remote revocation fails. */
      }
    return {
      disconnected: true,
      remote_revocation: revoked ? "confirmed" : "unconfirmed",
    };
  }
}
