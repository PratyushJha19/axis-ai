import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>) {
  await sql`
    alter table tasks add column deadline_reminders boolean not null default true;
    create table task_deadline_alerts (
      id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id), task_id uuid,
      source_due timestamptz not null, hours_before integer not null check(hours_before in (12,24)),
      reminder_id uuid unique references reminders(id) on delete set null,
      unique(user_id,task_id,source_due,hours_before),
      foreign key(user_id,task_id) references tasks(user_id,id) on delete set null (task_id)
    );
    create function sync_task_deadlines() returns trigger language plpgsql as $$
    declare hours integer; alert_time timestamptz; reminder uuid;
    begin
      if TG_OP='UPDATE' and (NEW.due_at is distinct from OLD.due_at
          or (NEW.deadline_reminders and not OLD.deadline_reminders)
          or (OLD.status in ('completed','cancelled') and NEW.status not in ('completed','cancelled'))
          or (OLD.archived_at is not null and NEW.archived_at is null)) then
        -- A deliberate re-enrolment can replace cancelled offsets while preserving their evidence.
        update task_deadline_alerts a set task_id=null from reminders r where a.reminder_id=r.id
          and a.user_id=NEW.user_id and a.task_id=NEW.id and a.source_due=NEW.due_at and r.status='cancelled';
        update task_deadline_alerts set task_id=null where user_id=NEW.user_id and task_id=NEW.id
          and source_due=NEW.due_at and reminder_id is null;
      end if;
      -- Preserve attempts already crossing the dispatch boundary: uncertainty must remain visible.
      update reminders r set status='cancelled',cancelled_at=now(),next_attempt_at=null,
        lease_token=null,lease_until=null,version=r.version+1,reason='task_deadline_changed'
      from task_deadline_alerts a where a.reminder_id=r.id and a.task_id=NEW.id and a.user_id=NEW.user_id
        and (NEW.due_at is distinct from a.source_due or not NEW.deadline_reminders
          or NEW.status in ('completed','cancelled') or NEW.archived_at is not null)
        and r.status in ('scheduled','snoozed','failed')
        and not exists(select 1 from notification_attempts n where n.reminder_id=r.id and n.status in ('sending','sent','unknown'));
      if NEW.due_at is not null and NEW.deadline_reminders and NEW.archived_at is null
         and NEW.status not in ('completed','cancelled') then
        foreach hours in array ARRAY[24,12] loop
          alert_time := NEW.due_at - make_interval(hours=>hours);
          if alert_time > now() then
            insert into task_deadline_alerts(user_id,task_id,source_due,hours_before)
              values(NEW.user_id,NEW.id,NEW.due_at,hours) on conflict do nothing;
            if FOUND then
              reminder := gen_random_uuid();
              insert into reminders(id,user_id,title,body,task_id,project_id,due_at,local_due,timezone,
                recurrence,disambiguation,next_attempt_at,idempotency_key,correlation_id)
              values(reminder,NEW.user_id,NEW.title,'Task deadline in ' || hours || ' hours.',NEW.id,NEW.project_id,
                alert_time,to_char(alert_time at time zone NEW.due_timezone,'YYYY-MM-DD"T"HH24:MI:SS'),NEW.due_timezone,
                'none','reject',alert_time,gen_random_uuid(),gen_random_uuid());
              update task_deadline_alerts set reminder_id=reminder where user_id=NEW.user_id and task_id=NEW.id
                and source_due=NEW.due_at and hours_before=hours;
            end if;
          end if;
        end loop;
      end if;
      update reminders r set title=NEW.title,project_id=NEW.project_id from task_deadline_alerts a
        where a.reminder_id=r.id and a.task_id=NEW.id and a.user_id=NEW.user_id
        and r.status in ('scheduled','snoozed') and not exists(
          select 1 from notification_attempts n where n.reminder_id=r.id and n.status in ('sending','sent','unknown'));
      return NEW;
    end $$;
    create trigger tasks_deadline_sync after insert or update on tasks for each row execute function sync_task_deadlines();
    create table canvases (
      id uuid primary key, user_id uuid not null references users(id), project_id uuid,
      name text not null check(length(name) between 1 and 120), viewport jsonb not null,
      version integer not null default 1, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
      unique(user_id,id), foreign key(user_id,project_id) references projects(user_id,id)
    );
    create index canvases_owner on canvases(user_id,project_id,updated_at);
    create table canvas_nodes (
      id uuid not null, canvas_id uuid not null, user_id uuid not null, kind text not null,
      title text not null, content text not null default '', x double precision not null,y double precision not null,
      width double precision not null, height double precision not null, task_id uuid,
      primary key(canvas_id,id), foreign key(user_id,canvas_id) references canvases(user_id,id) on delete cascade,
      foreign key(user_id,task_id) references tasks(user_id,id) on delete set null (task_id)
    );
    create table canvas_edges (
      id uuid not null,canvas_id uuid not null,user_id uuid not null,source uuid not null,target uuid not null,label text not null,
      primary key(canvas_id,id),foreign key(user_id,canvas_id) references canvases(user_id,id) on delete cascade,
      foreign key(canvas_id,source) references canvas_nodes(canvas_id,id) on delete cascade,
      foreign key(canvas_id,target) references canvas_nodes(canvas_id,id) on delete cascade
    );
    update foundation_metadata set schema_version=14 where id=1;
  `.execute(db);
}
