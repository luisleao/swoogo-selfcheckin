# Backend/API And External Integrations Backlog

This backlog covers the Express API, Firebase Admin auth, event-scoped authorization, and external integrations for Swoogo and SendGrid. It assumes the product behavior described in `docs/automatic-event-credentialing.md` is the source of truth.

## Suggested Order

1. API foundation, shared request contracts, audit logging, and Firestore transaction helpers.
2. Firebase Admin authentication middleware and event-scoped role checks.
3. Integration configuration and secret loading for Swoogo and SendGrid.
4. Swoogo token, registrant, session, and scan client.
5. Participant import and manual registration flows.
6. SendGrid template resolution, message jobs, mail send, and webhook ingestion.
7. Pre-check-in, queue assignment, credential reservation, and print job creation APIs.
8. Credential void, reprint, reissue, and delivery APIs.
9. Session administration and mobile session check-in APIs.
10. Controlled-area, gate, passage, and access override APIs.
11. Dashboard/stat read APIs, reconciliation jobs, and operational hardening.

## Epic 1: Express API Foundation

Tasks:

- Create the Express app and mount all event-scoped routes under `/api/events/:eventId`.
- Add request validation, normalized error responses, request IDs, structured logging, and async route handling.
- Add a common API envelope for success, validation errors, authorization failures, provider errors, and transactional conflicts.
- Add Firestore Admin initialization, server timestamp helpers, batched write helpers, transaction retry wrappers, and deterministic document ID helpers where required.
- Add shared audit logging for sensitive mutations, with actor, role, event ID, resource type, resource ID, action, metadata, and request ID.
- Add health/readiness endpoints that verify process health without exposing integration secrets.

Dependencies:

- Firebase project configuration and service account strategy.
- Agreement on runtime target: long-running Node.js Express server or Express deployed through Firebase Functions/Cloud Run.
- Firestore collection paths from the architecture doc.

Acceptance criteria:

- Every route can attach an `eventId`, request ID, authenticated actor, and audit context.
- Validation failures return consistent 400 responses with field-level details.
- Authorization failures return 401 or 403 without leaking whether protected resources exist.
- Provider failures from Swoogo and SendGrid are mapped to consistent API errors and logged with safe metadata.
- At least one smoke test covers health, unknown route, validation failure, and authenticated route rejection.

## Epic 2: Firebase Admin Auth And Event Roles

Tasks:

- Initialize Firebase Admin SDK once per process.
- Implement `requireFirebaseAuth` middleware that validates `Authorization: Bearer <Firebase ID token>`.
- Load `users/{uid}` and reject inactive users.
- For event routes, load `events/{eventId}/members/{uid}` and reject inactive or missing memberships.
- Implement role helpers for global roles, `super_admin`, and event roles.
- Add resource-scoped checks for allowed queues, sessions, areas, and gates.
- Define route permission policies for `event_admin`, `event_manager`, `precheckin_operator`, `print_operator`, `credential_reissuer`, `session_operator`, `gate_operator`, `area_manager`, and `viewer`.
- Add test helpers to mint or stub Firebase users and membership documents.

Dependencies:

- Epic 1 routing and error handling.
- Firestore `users` and `members` schemas.
- Security decision on whether terminal accounts are normal Firebase users or service-like identities.

Acceptance criteria:

- Missing, malformed, expired, and revoked tokens are rejected.
- Active event members can access only routes permitted by their roles.
- `super_admin` can manage all events without duplicating event memberships.
- Operators cannot call integration configuration, role-management, or credential-reissue routes unless explicitly permitted.
- Session, gate, queue, and area operators are blocked when the requested resource is outside their allowed ID list.

## Epic 3: Integration Configuration And Secrets

Tasks:

- Implement event integration loaders for `events/{eventId}.swoogo` and `events/{eventId}.sendgrid`.
- Resolve secret references for Swoogo consumer key/secret and SendGrid API keys from the chosen secret backend.
- Support encrypted Firestore integration fields only if secret manager is unavailable.
- Add admin-only test routes:
  - `POST /api/events/:eventId/swoogo/test-connection`
  - `POST /api/events/:eventId/sendgrid/test-connection`
  - `POST /api/events/:eventId/sendgrid/test-email`
- Validate configuration completeness without returning raw secret values.
- Add audit logs for integration tests and configuration changes.

Dependencies:

- Epic 2 role checks.
- Secret manager or encryption approach.
- Event document shape for integration metadata.

Acceptance criteria:

- Raw Swoogo and SendGrid secrets are never returned by API responses.
- Disabled integrations fail fast with actionable operator-facing errors.
- Test connection routes prove credentials work against providers or return safe provider error summaries.
- Audit logs identify who tested or changed an integration and which event configuration was used.

## Epic 4: Swoogo Client And Sync Primitives

Tasks:

- Build a Swoogo client with per-event base URL, `client_credentials` token exchange, token caching, refresh-before-expiry, and refresh-on-401.
- Implement provider methods for:
  - `GET /registrants?event_id=...` with pagination.
  - `GET /registrants/{registrant_id}`.
  - registrant search by normalized email.
  - `POST /registrants/create`.
  - `PUT /registrants/update/{registrant_id}`.
  - `POST /registrants/{registrant_id}/session/{session_id}`.
  - `GET /sessions?event_id=...` with pagination.
  - `POST /sessions/create`.
  - `PUT /sessions/update/{session_id}`.
  - `POST /scans/registrant/{registrant_id}/session/{session_id}`.
  - `GET /scans/sessions?event_id=...` for reconciliation.
- Centralize Swoogo-to-local field mapping for participants, registration types, sessions, and scans.
- Add rate-limit handling, bounded retries, provider timeouts, and safe logging.
- Persist sync job status in `events/{eventId}/syncJobs/{syncJobId}`.

Dependencies:

- Epic 3 secret loading.
- Final field map for Swoogo registrants and sessions.

Acceptance criteria:

- Token caching is event-specific and never shared across events.
- All list endpoints handle pagination and partial failure reporting.
- Swoogo IDs are validated against the selected event before local writes.
- Provider errors preserve enough metadata for troubleshooting without storing secrets or excessive PII.
- Unit tests cover token refresh, pagination, duplicate handling, and scan submission failures.

## Epic 5: Participant Import And Manual Registration

Tasks:

- Implement `POST /api/events/:eventId/sync/registrants`.
- Upsert imported registrants into `events/{eventId}/participants/{registrantId}` with normalized email, registration type, status, session IDs, and source metadata.
- Create idempotent message jobs for confirmation emails when requested.
- Implement `POST /api/events/:eventId/manual-registrations`.
- Normalize and duplicate-check email locally before creating in Swoogo.
- Create the Swoogo registrant first, then persist the local participant only after receiving the Swoogo registrant ID.
- Add optional Swoogo session enrollment for selected sessions.
- Support `sendSwoogoEmail`, `sendCredentialEmail`, and admin-only capacity override flags.
- Write audit logs for import, duplicate reconciliation, manual create, Swoogo session enrollment, and local participant creation.

Dependencies:

- Epic 4 Swoogo client.
- Epic 6 message job creation if credential emails are sent immediately.
- Role policies for `event_admin` and `event_manager`.

Acceptance criteria:

- Import is idempotent and can be resumed after partial failure.
- A local manual participant is not created unless Swoogo creation succeeds or an authorized reconciliation path links an existing Swoogo registrant.
- Duplicate local email and duplicate Swoogo email cases return clear reconciliation responses.
- Manual registration stores `source.manualRegistration = true` and `source.createdBy = manual_admin`.
- Confirmation email jobs are created once per participant/purpose unless an admin explicitly resends.

## Epic 6: SendGrid Templates, Message Jobs, And Webhooks

Tasks:

- Implement template management routes:
  - `POST /api/events/:eventId/sendgrid/templates`
  - `PUT /api/events/:eventId/sendgrid/templates/:templateConfigId`
- Implement template resolution by purpose, including `credential_confirmation`, `manual_registration_confirmation`, `reissue_notification`, and future purposes.
- Implement `POST /api/events/:eventId/messages/confirmation` for targeted or bulk confirmation sends.
- Create `messageJobs` with provider, channel, recipient, template purpose, QR payload, config snapshot, status, attempts, provider IDs, timestamps, and last error.
- Implement a worker or route-safe dispatcher that calls SendGrid `POST /v3/mail/send`.
- Add retry limits, dead-letter status, idempotency by message job ID, and resend controls.
- Implement `POST /api/events/:eventId/sendgrid/events` to ingest Event Webhook delivery, bounce, drop, deferred, open, and click events.
- Verify webhook signatures if signing is configured.

Dependencies:

- Epic 3 SendGrid secret loading.
- Participant import/manual registration for recipients.
- Decision on QR image generation or hosted QR image URL strategy.

Acceptance criteria:

- Event-specific SendGrid integration, sender, reply-to, and template configuration are snapshotted onto each message job.
- Mail send accepted responses mark provider submission, not final delivery.
- Delivered, bounced, dropped, and deferred webhooks update the related message job without creating duplicates.
- Sent or delivered messages are not resent unless an authorized admin requests a resend.
- Webhook ingestion rejects invalid signatures when a signing key is configured.

## Epic 7: Pre-check-in APIs, Queue Assignment, And Credential Reservation

Tasks:

- Implement `POST /api/events/:eventId/pre-checkins`.
- Accept either confirmation QR `registrantId` or normalized email.
- If the participant is missing or stale, fetch from Swoogo and upsert locally after validating event ownership.
- Make pre-check-in idempotent for existing `prechecked`, `queued`, `printing`, `printed`, and `delivered` states.
- In one Firestore transaction:
  - validate participant state.
  - select an active queue by registration type and weighted demand.
  - create or reserve `credentials/{badgeId}` using a Firestore auto ID.
  - compose credential payload as `BADGEID;epochSeconds;SWOOGOID`.
  - create `printJobs/{jobId}` and `queueEntries/{entryId}`.
  - update participant credentialing fields and queue metrics.
- Return participant, queue, queue position/status, and existing-state details.
- Audit terminal, operator, input mode, queue assignment, credential reservation, and print job creation.

Dependencies:

- Epic 2 `precheckin_operator` role.
- Epic 4 Swoogo registrant fetch.
- Queue configuration and default queue per event.

Acceptance criteria:

- Repeated scans do not create duplicate credentials or print jobs.
- A missing local participant can be recovered from Swoogo by registrant ID or email.
- Queue assignment falls back to the event default queue when no compatible queue exists.
- Credential IDs use Firestore-generated random badge IDs and the required QR format.
- Transactional failures leave no partial credential, print job, or queue metric updates.

## Epic 8: Credential Lifecycle, Void, Reprint, Reissue, And Delivery APIs

Tasks:

- Implement print job routes:
  - `POST /api/events/:eventId/print-jobs/:jobId/claim`
  - `POST /api/events/:eventId/print-jobs/:jobId/complete`
  - `POST /api/events/:eventId/print-jobs/:jobId/fail`
- Implement pickup delivery route:
  - `POST /api/events/:eventId/queue-entries/:entryId/deliver`
- Implement credential routes:
  - `POST /api/events/:eventId/credentials/:badgeId/reprint`
  - `POST /api/events/:eventId/credentials/:badgeId/void`
  - `POST /api/events/:eventId/credentials/:badgeId/reissue`
- Add shared credential QR parser and active credential validator.
- On reissue, require `credential_reissuer` or `event_admin`, require a reason, void the previous active credential, create a new credential with a new auto ID, create a new print job, and update participant active badge fields in one transaction.
- On void, record reason, actor, timestamp, and replacement metadata when applicable.
- On cancelled/void credential scan, return a blocking response with `result = blocked`, `reason = credential_void`, participant summary, scanned badge ID, active badge ID, and void reason.
- Write audit logs for claim, print success, print failure, delivery, reprint, void, reissue, and cancelled scan detection.

Dependencies:

- Epic 7 credential and print job creation.
- Print terminal identity/role model.
- Badge pickup UI expectations for delivery and cancelled badge alerts.

Acceptance criteria:

- Only one active delivered credential exists per participant unless an audited `event_admin` exception path is added.
- Reissue always invalidates the old badge and never reuses the old `BADGEID`.
- Failed printing of a replacement does not silently restore the voided badge.
- Credential validation rejects malformed payloads, event mismatches, badge ID mismatches, timestamp mismatches, Swoogo ID mismatches, missing credentials, and void credentials.
- Delivery updates queue entry, credential, participant, and audit log consistently.

## Epic 9: Session Administration And Swoogo Session Check-in

Tasks:

- Implement session admin routes:
  - `POST /api/events/:eventId/sessions/import`
  - `POST /api/events/:eventId/sessions`
  - `PUT /api/events/:eventId/sessions/:sessionId`
- Import Swoogo sessions into `events/{eventId}/sessions/{sessionId}`.
- Create and update sessions in Swoogo first when the local action represents a remote session change.
- Support local `accessAreaId`, `accessAreaName`, and `enforceAreaPermissionForSessions` fields.
- Implement `POST /api/events/:eventId/sessions/:sessionId/checkins`.
- Accept printed credential QR payloads and fallback confirmation QR registrant IDs.
- Validate operator, allowed session IDs, participant, session status, event ownership, and active credential when a credential QR is used.
- Write deterministic `sessionCheckins/{sessionId_registrantId}` records.
- Call Swoogo `POST /scans/registrant/{registrant_id}/session/{session_id}` and store scan IDs or sync failures.
- Support `prevent_check_in` where needed.
- If the session is linked to an access area, record a local area passage and update participant current area after successful session check-in.
- If `enforceAreaPermissionForSessions = true`, evaluate area permissions before Swoogo scan submission.

Dependencies:

- Epic 4 Swoogo session and scan client.
- Epic 8 credential parser and validator.
- Epic 10 area permission evaluator for linked sessions.

Acceptance criteria:

- Duplicate session scans return the existing local check-in state without double-submitting to Swoogo.
- Swoogo scan failures are recorded as sync failures with retry/reconciliation metadata.
- Session-linked area movement never creates an additional Swoogo session scan.
- Operators are blocked from sessions outside their allowed session list.
- Cancelled badges produce the same blocking response shape used by gate and pickup scans.

## Epic 10: Gate Access, Controlled Areas, And Passage APIs

Tasks:

- Implement access area routes:
  - `POST /api/events/:eventId/access-areas`
  - `PUT /api/events/:eventId/access-areas/:areaId`
  - `POST /api/events/:eventId/access-areas/:areaId/participant-overrides`
  - `DELETE /api/events/:eventId/access-areas/:areaId/participant-overrides/:registrantId`
- Implement gate routes:
  - `POST /api/events/:eventId/gates`
  - `PUT /api/events/:eventId/gates/:gateId`
  - `POST /api/events/:eventId/gates/:gateId/scans`
- Build an area permission evaluator with this order:
  - block malformed, missing, wrong-event, inactive, or void credentials.
  - deny participant-specific deny overrides.
  - allow participant-specific allow overrides.
  - deny denied registration types.
  - allow allowed registration types.
  - apply `defaultDecision`.
- On allowed gate scans, write `areaPassages/{passageId}`, mirror to participant `accessPassages`, and update participant `presence.currentAreaId`.
- On denied or blocked scans, write passage/audit records without changing current area.
- Ensure gate access never calls Swoogo session scan endpoints.
- Support gate/operator restrictions by allowed gate IDs and allowed area IDs.

Dependencies:

- Epic 8 credential validation.
- Epic 2 resource-scoped role checks.
- Access area and gate Firestore schemas.

Acceptance criteria:

- Allowed scans return immediate allow responses and update the participant's current area.
- Denied scans record the attempt and reason but do not update current area.
- Void credential scans return the red-alert response shape and write `credential.cancelled_scan_detected`.
- Gate scan code path has no dependency on Swoogo scans and cannot create session attendance.
- Participant occupancy can be derived from `participants.presence.currentAreaId` because each participant has at most one current area.

## Epic 11: Dashboard, Reconciliation, And Operational Hardening

Tasks:

- Implement `GET /api/events/:eventId/dashboard/stats` for event managers and viewers.
- Aggregate participants, credential states, message jobs, queue timing, print failures, session check-ins, gate passages, current area occupancy, Swoogo call status, and SendGrid call status.
- Add optional aggregated stats documents under `events/{eventId}/stats/...` for high-volume events.
- Add Swoogo reconciliation jobs for registrants, sessions, and session scans.
- Add SendGrid message reconciliation from webhook events and failed job retries.
- Add dead-letter handling for failed sync jobs and message jobs.
- Add alert-ready metrics for stuck print jobs, missing terminal heartbeat, provider error rate, repeated reissues, and repeated cancelled badge scans.

Dependencies:

- Epics 5 through 10 producing operational data.
- Decision on live query versus precomputed stats by event size.

Acceptance criteria:

- Dashboard stats are event-scoped and readable only by `viewer`, `event_manager`, `event_admin`, or `super_admin`.
- Current area occupancy is computed from participant presence, not by summing historical passages.
- Reconciliation jobs are idempotent and auditable.
- Failed provider jobs can be retried or marked dead-letter without losing original error context.
- Metrics distinguish local success, provider submission success, provider delivery success, and provider sync failure.

## Cross-Epic API Quality Bar

- Every mutation writes an audit log unless explicitly documented as safe to omit.
- Every provider call includes timeout, retry policy, safe logging, and event-scoped configuration.
- Every event route enforces Firebase auth and event membership before sensitive reads or writes.
- Every state transition is either transactional or has an explicit recovery/reconciliation path.
- Every idempotent operation documents its idempotency key or deterministic document ID.
- Every route handling QR payloads supports malformed input, wrong event, missing participant, void credential, inactive credential, and duplicate scan cases.
- Tests cover happy path, duplicate/idempotent path, forbidden role, missing resource, provider failure, and transaction conflict for each major workflow.
