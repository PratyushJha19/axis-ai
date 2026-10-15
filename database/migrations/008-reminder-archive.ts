import { sql, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";
export async function up(db: Kysely<Database>) {
  await sql`
    alter table reminders add column archived_at timestamptz;
    create function set_reminder_archive() returns trigger language plpgsql as $$
    begin
      if new.status='cancelled' or (new.recurrence='none' and new.next_attempt_at is null and not new.attention and
        (new.status='delivered' or (new.status='sent' and new.reason='telegram_sent'))) then
        if TG_OP='UPDATE' then new.archived_at=coalesce(old.archived_at,now());
        else new.archived_at=now(); end if;
      else new.archived_at=null;
      end if;
      return new;
    end $$;
    create trigger reminder_archive before insert or update on reminders for each row execute function set_reminder_archive();
    -- Existing completed reminders get a full seven-day grace period at upgrade.
    update reminders set archived_at=now() where status='cancelled' or
      (recurrence='none' and next_attempt_at is null and not attention and
      (status='delivered' or (status='sent' and reason='telegram_sent')));
    create index reminder_archive_due on reminders(archived_at) where archived_at is not null;
    update foundation_metadata set schema_version=8 where id=1;
  `.execute(db);
}
