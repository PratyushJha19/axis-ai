# AXIS disaster recovery — operator procedure

Targets: RPO 24 hours, RTO 4 hours. Neither is guaranteed by a sleeping local PC.
No production host, independent storage or active scheduler has been verified.
Do not resume notifications simply because PostgreSQL restored successfully.

## Before an incident

Keep encrypted backups on a private off-machine volume available to the operator.
Keep seven daily points and a monthly point. Use `npm run backup`, then
`npm run backup:verify` and `npm run backup:restore-check`. The latter requires a
local disposable PostgreSQL server and CREATE/DROP DATABASE privileges. It creates
only a unique `axis_restore_<uuid>` database and drops only that database. It never
starts AXIS or sends messages. Successful verification checks every table's snapshot
count, migration/schema version, restored constraints/index validity, and decrypts
all saved AI/Calendar credentials using the external application keyring. An empty
installation can restore successfully; it is not evidence for real user records.

Store the following separately from the database and backup artifacts: backup key
and version, AI_CREDENTIALS_ENCRYPTION_KEY and all previous key versions, Google
client credentials, SESSION_SECRET, database credentials, Telegram and any email
credentials. Backups deliberately contain application-encrypted credentials and
session records inside whole-archive AES-GCM encryption; keep access operator-only.
No secret is printed by the supplied commands. Keep the matching application
release/lockfile and PostgreSQL 18 clients. Database roles and server configuration
are not included; create the restore role separately. Custom dumps preserve schema,
data, sequences and extensions but restore without original ownership/ACLs.

## Incident recovery

1. Record incident start and scope. Stop API, reminder worker, agent worker and any
   scheduled job before restoring. Isolate compromised hosts and revoke compromised
   provider credentials through their trusted consoles.
2. Select a verified artifact and matching key version. Run `npm run backup:verify --
<backup-uuid>` and an isolated restore check before choosing it. Confirm its
   timestamp against the 24-hour objective and record actual possible data loss.
3. Obtain recovery secrets through the operator's secure channel. Do not put keys
   in chat, shell command arguments, screenshots or incident logs.
4. Identify a NEW empty recovery database and obtain explicit authorization for
   infrastructure/cutover. Never point a restore at an existing development or
   production database. The supplied automated restore command deliberately supports
   new local databases only; a production restore/cutover is a reviewed operator
   operation. `npm run backup:restore-new -- <backup-uuid>
--confirm-new-isolated-database` creates a fresh `axis_restore_<uuid>` database,
   verifies the artifact and restores through an authenticated decrypting stream.
   It checks integrity/keys, invalidates sessions and OAuth challenges, and leaves
   the new database quarantined. It prints the new database name and safe metadata.
   It cannot accept an existing target name or overwrite a database. Configure the
   new DATABASE_URL privately for reviewed cutover. Preserve the old environment.
5. Before starting AXIS, use the restored DATABASE_URL and run
   `npm run recovery:quarantine`. This persistent flag makes API operations and
   readiness fail closed and stops workers at their readiness checks. Workers must
   already be stopped; the flag cannot recall an external request already underway.
6. Verify schema 12/migration 012 and the matching application release. Do not run
   forward migrations blindly during an incident. The restore check rejects
   incompatible versions. Invalidate restored sessions and pending OAuth challenges
   through a reviewed operator database transaction; require fresh sign-in.
7. Review the cases below with the owner. Keep unresolved jobs quarantined. No
   automatic approval replay, pending-message replay or approval renewal is allowed.
8. Configure keys privately, confirm authentication and owner-scoped task/project/
   memory access in the isolated environment. Check reminder recurrence/attempts,
   Telegram consent, approval history and agent runs. Compare post-snapshot changes
   with independent authoritative evidence; task completion after backup is lost
   unless independently recovered. Do not infer completion from model prose.
9. Calendar tokens may have been revoked after the snapshot. Require a read-only
   refresh or reconnect; cached events do not prove valid consent. Do not create
   calendar events during recovery. Test key decryption without printing values.
10. Only after a documented reconciliation and explicit operator authorization,
    release `recovery_control.quarantined` in a reviewed transaction. There is no
    ordinary-user API or one-click release command. Start API, then reminder and
    agent workers. Check `/health/ready`, `npm run worker:health`, notification
    uncertainty, pending approvals and job backlog before allowing new work.
11. Confirm service usability with the owner, record elapsed recovery time, actual
    loss window and unresolved records. Report whether RPO/RTO were met. Notify
    people only through explicitly authorized channels.

## External effects and uncertainty

| Snapshot gap                                  | Required handling before release                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reminder delivered after snapshot             | The restored pending row is not proof it was unsent. Compare independent provider/user evidence; suppress or mark uncertain rather than resend.                                |
| Telegram accepted but receipt lost            | Telegram has no delivery-history lookup for this case. Preserve unknown; owner review is required.                                                                             |
| External action happened without saved result | Current executors have no external action support. Future handlers must reconcile authoritative evidence; never replay an approval from a snapshot.                            |
| Approval expired after backup                 | Wall-clock expiry still applies. Do not extend expiry; pending/approved records require normal backend validation.                                                             |
| Task completed after backup                   | Restore cannot invent the missing update; owner correction or independent evidence is needed.                                                                                  |
| Worker/model job in progress                  | Existing leases recover ordinary crashes, but snapshot loss adds uncertainty beyond leases. Keep global quarantine until review; do not automatically restart inference/sends. |
| Calendar token revoked after backup           | Refresh returns reauthorization status. Clear local connection/reconnect through explicit consent.                                                                             |

## Scheduling, storage and alerts

On Windows, protect a new dedicated directory using NTFS ACLs granting only the
operator, SYSTEM and Administrators. The tool checks those allowed SIDs and fails
closed for broader grants. On Unix, use a dedicated operator directory with mode 0700. No backup download endpoint exists. Configure BACKUP_DIRECTORY outside public
web/upload paths; choose an independently protected mounted storage volume for real
recovery. Local `.local` storage is suitable for synthetic tests only.

Set BACKUP_ENCRYPTION_KEY to a separately generated 32-byte base64 secret and set
BACKUP_KEY_VERSION. Never reuse the application key or keep the sole key copy with
the artifacts. For rotation, use a new key/version for new artifacts, preserve old
keys separately and supply the matching version when verifying/restoring old points.
Retain old keys until all corresponding recovery points are intentionally retired.
Application key rotation uses `npm run ai:rotate-keys`, now including Calendar;
pending Calendar consent flows are invalidated. Stop API/agent operations first.

The operator can run `scripts/install-backup-schedule.ps1 -NodePath <absolute-node.exe>`
from an elevated PowerShell after reviewing it. It registers SYSTEM tasks at local
02:00 daily for backup, 03:00 on day 1 for restore-check, and 04:00 daily for health.
It wakes when possible and catches missed starts, but cannot run on a powered-off
machine. Verify SYSTEM can access the application, secrets and protected volume.
No tasks were installed by this implementation. Scheduler logs/nonzero exit codes
and private `last-failure.json` are operator signals; configure an operational alert
for failed task results. `backup-scheduled.ps1` additionally supports local Windows
Application event alerts when invoked by an operator with event-log permissions.
Remote alert delivery is not configured or claimed. Check `npm run backup:health`
for backup age >24h, restore age >32 days, missing evidence and corrupted artifacts.

Retention runs only after a new fully verified dump. It keeps the newest successful
point on seven distinct UTC days and a point from an older month (or the oldest
available point while history accumulates). It cannot manufacture seven days on
day one. Corrupt/unverifiable artifacts are retained for review, not silently pruned.
Changing backup keys preserves unverifiable older artifacts; retire them manually
only after verifying usable replacements. Partial files and a stale backup.lock
after interruption require operator inspection. Confirm no backup process is alive
before removing only that lock; never delete known-good points to resolve disk-full.

No storage service or paid resource is provisioned. Storage capacity/cost, remote
replication, always-on execution, notifications and a full deployment recovery drill
remain operator decisions. A synthetic restore duration measures only the test DB,
not production RTO.
