# M1 API contract

All product routes are under `/api/v1`. `GET /auth/status` reports only whether auth
is configured. `/auth/google` and `/auth/google/callback` implement Google login.
Health routes remain public and content-free. Static frontend assets contain no
private records; protected records are fetched only after server-side authentication.

Authenticated API responses use `{error:{code,message,requestId}}` for errors. Every
write requires exact configured Origin and `X-CSRF-Token` from `GET /me`. Cookies are
HTTP-only and sessions live in PostgreSQL. JSON body limit: 32 KiB.

| Route                                           | Contract                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET /me                                         | `{user:{id,email,display_name,timezone},csrfToken}`                                                                 |
| PATCH /me                                       | `{display_name,timezone}`; validates IANA timezone                                                                  |
| POST /logout                                    | Revoke current server session; 204                                                                                  |
| GET /summary                                    | Owner-only counts: active_tasks, completed_tasks, projects, memories                                                |
| GET /projects, /tasks, /memories                | `{items,hasMore}`; limit 1–100 (default 30), offset, q, archived=false/true/all; project_id filter for tasks/memory |
| GET /projects/:id, /tasks/:id, /memories/:id    | Owner-scoped current record                                                                                         |
| POST /projects, /tasks, /memories               | Validated full create form; UUID Idempotency-Key required; 201                                                      |
| PATCH /projects/:id, /tasks/:id, /memories/:id  | Validated complete edit form; numeric If-Match version required; 200                                                |
| DELETE /projects/:id, /tasks/:id, /memories/:id | Numeric If-Match required; 204; linked project deletion conflicts                                                   |
| GET /tasks/:id/events                           | Owner-only history, limit/offset pagination                                                                         |

Runtime field definitions are in packages/shared/src/contracts.ts. Edit forms are
complete representations, not arbitrary partial patches. Unknown fields (including
user_id) are rejected. Server controls IDs, consent timestamps, source, completion
timestamps, versions and audit records. Ownership always derives from the session.

Create retries with the same key and normalized payload return the existing record;
changed payload/table returns 409. Replay after hard deletion returns 404 and never
recreates content. Retained request keys contain only hashes/IDs, no deleted content.
Stale version edits/deletes return 409. Missing/other-owner records return 404.
Memory search uses websearch_to_tsquery against an indexed English tsvector. Archived
memory is available when explicitly requested; hard-deleted content is never returned.

Memory requires sensitivity=ordinary/sensitive; sensitive input requires consent=true
on every save. Known personal-information words demand sensitive classification.
Common credential-shaped input is rejected even with consent. This is conservative
validation, not comprehensive automatic classification. Audit contains event names,
IDs and timestamps only. Terminal tasks must first reopen to inbox before changing
to another active state. No automatic rescheduling is performed.

Rate limits: 30 authentication requests/15 minutes and 300 API requests/minute,
in-memory for this single-process local slice. No proxy is trusted. These technical
defaults must be reviewed before any production deployment.
