# Data, Security, Audit, And Analytics Backlog

## Scope

This backlog covers the data model, Firestore indexes, security rules, event-scoped authorization, secret handling, audit logging, transactional/idempotent workflows, access-area evaluation, occupancy, dashboard aggregates, queue-time metrics, monitoring, and reconciliation for the automatic event credentialing system.

It assumes the product model from `docs/automatic-event-credentialing.md`: every operational document is scoped to `events/{eventId}`, Firebase Auth identifies users and terminals, the backend owns sensitive mutations, and each event has isolated Swoogo and SendGrid configuration.

## Suggested Order

1. Create the Firestore collection contracts, status enums, and indexes.
2. Implement Auth token validation, event role resolution, and a reusable role matrix.
3. Add Firestore Security Rules with default-deny isolation and rules tests.
4. Implement event-specific secret references and backend-only integration config loading.
5. Build transactional/idempotent mutation helpers for credentialing, printing, sessions, gates, and messages.
6. Add append-only audit logs around every sensitive mutation.
7. Implement area permission evaluation and current-area updates.
8. Create dashboard aggregate writers and queue-time metric calculators.
9. Add monitoring, dead-letter handling, and reconciliation jobs.

## Epic 1: Firestore Model And Indexes

**Goal:** Establish event-isolated Firestore paths and query support before API work depends on them.

**Tasks**

- Provision and use the named Firestore database `attendee-registry`; do not use the project `(default)` database for credentialing data.
- Define typed document contracts for:
  - `users/{uid}`
  - `events/{eventId}`
  - `events/{eventId}/members/{uid}`
  - `events/{eventId}/participants/{registrantId}`
  - `events/{eventId}/registrantTypes/{registrationTypeId}`
  - `events/{eventId}/queues/{queueId}`
  - `events/{eventId}/queueEntries/{entryId}`
  - `events/{eventId}/printTerminals/{terminalId}`
  - `events/{eventId}/printJobs/{jobId}`
  - `events/{eventId}/credentials/{badgeId}`
  - `events/{eventId}/badgeLayouts/{layoutId}`
  - `events/{eventId}/sessions/{sessionId}`
  - `events/{eventId}/sessionCheckins/{sessionId_registrantId}`
  - `events/{eventId}/accessAreas/{areaId}`
  - `events/{eventId}/accessAreas/{areaId}/participantOverrides/{registrantId}`
  - `events/{eventId}/gates/{gateId}`
  - `events/{eventId}/areaPassages/{passageId}`
  - `events/{eventId}/participants/{registrantId}/accessPassages/{passageId}`
  - `events/{eventId}/messageJobs/{messageJobId}`
  - `events/{eventId}/sendgridTemplates/{templateConfigId}`
  - `events/{eventId}/syncJobs/{syncJobId}`
  - `events/{eventId}/auditLogs/{auditLogId}`
  - `events/{eventId}/stats/current`
  - `events/{eventId}/stats/queues`
  - `events/{eventId}/stats/sessions`
  - `events/{eventId}/stats/areas`
  - `events/{eventId}/stats/timeBuckets/{bucketId}`
- Document status enums and legal transitions for participant credentialing, credentials, print jobs, queue entries, message jobs, session check-ins, sync jobs, and area passages.
- Standardize deterministic IDs where duplicate prevention matters:
  - participants: Swoogo registrant ID;
  - initial print jobs: `badge-{registrantId}`;
  - session check-ins: `{sessionId}_{registrantId}`;
  - message jobs: `{purpose}_{registrantId}` or another stable event-scoped idempotency key;
  - sync jobs: `{provider}_{jobType}_{timeBucket}` when scheduled.
- Require `eventId`, actor fields, `createdAt`, and `updatedAt` on all operational documents where they aid debugging, even when event scoping is structural.
- Add composite indexes for:
  - participants: `normalizedEmail`, `credentialing.status`, `registrationTypeId`, `presence.currentAreaId`, `source.manualRegistration`;
  - print jobs: `status + queueId + priority + createdAt`, `terminalId + status + claimedAt`;
  - credentials: `participantId + status`, `credentialId`, `swoogoRegistrantId + status`, `status + issuedAt`;
  - queue entries: `status + queueId + createdAt`, `participantId + createdAt`;
  - sessions: `date + startTime + status`, `accessAreaId + date`;
  - session check-ins: `sessionId + registrantId`, `status + checkedInAt`, `operatorUid + checkedInAt`;
  - participant overrides collection group: `participantId`, `decision + validUntil`;
  - gates: `status`, `targetAreaId`;
  - area passages: `targetAreaId + scannedAt`, `participantId + scannedAt`, `credentialBadgeId + scannedAt`, `result + scannedAt`, `source + scannedAt`, `gateId + scannedAt`;
  - access passages collection group: `participantId + scannedAt`, `targetAreaId + scannedAt`, `gateId + scannedAt`, `result + scannedAt`;
  - message jobs: `status + createdAt`, `provider + providerMessageId`, `templatePurpose + status`;
  - audit logs: `actorUid + createdAt`, `action + createdAt`, `resourceType + resourceId + createdAt`.

**Dependencies:** None.

**Acceptance Criteria**

- A schema reference exists for every collection above, with required fields and owner service called out.
- Firestore indexes support the MVP query list without collection scans across events.
- A new event can be created without sharing operational data, indexes, integration config, or stats with any other event.
- Invalid state transitions are documented before workflow code is written.

## Epic 2: Authorization And Security Rules

**Goal:** Make event isolation enforceable at the API and Firestore layers.

**Tasks**

- Implement Firebase ID token verification in the backend for every route.
- Create a role resolver that loads `events/{eventId}/members/{uid}` and rejects inactive members.
- Use custom claims only for small global flags, such as `superAdmin: true`; keep event roles and event access lists in Firestore.
- Define a route-to-role matrix for `super_admin`, `event_admin`, `event_manager`, `precheckin_operator`, `print_operator`, `credential_reissuer`, `session_operator`, `gate_operator`, `area_manager`, and `viewer`.
- Enforce resource scopes from membership documents:
  - queues through `allowedQueueIds`;
  - sessions through `allowedSessionIds`;
  - areas through `allowedAreaIds`;
  - gates through `allowedGateIds`.
- Add Firestore Security Rules with:
  - default deny;
  - active event-member reads for non-secret operational data;
  - backend-only writes for credentials, print jobs, counters, role documents, integration settings, audit logs, and stats;
  - no direct client reads of raw or encrypted Swoogo and SendGrid secrets;
  - no cross-event reads or writes through guessed IDs.
- Add rules tests for cross-event isolation, inactive users, missing roles, terminal scope restrictions, secret denial, and blocked direct writes.

**Dependencies:** Epic 1.

**Acceptance Criteria**

- A user with access to one event cannot read or mutate another event by changing `eventId`.
- Custom claims do not contain per-event role lists.
- Firestore rules deny all sensitive writes unless performed by the trusted backend path.
- Rules tests cover every role used by an MVP interface.

## Epic 3: Event Secrets And Integration Config

**Goal:** Keep Swoogo and SendGrid credentials event-specific and unavailable to clients.

**Tasks**

- Store integration metadata on `events/{eventId}` and `sendgridTemplates`, but store raw secrets in Secret Manager.
- Represent each secret as a versioned reference, for example `projects/.../secrets/sendgrid-api-key-event-2026/versions/latest`.
- Implement a backend secret loader that resolves Swoogo and SendGrid secrets only after role checks pass.
- Support a documented encrypted-Firestore fallback using KMS if Secret Manager is unavailable; deny direct client reads of encrypted fields.
- Include integration snapshots in `messageJobs`, sync jobs, and audit metadata so retries explain which event config was used.
- Add rotation support by updating secret refs without rewriting historical operational documents.
- Add tests that admin read APIs redact raw secret values.

**Dependencies:** Epics 1 and 2.

**Acceptance Criteria**

- Clients can configure sender metadata, template IDs, and enabled flags without receiving API keys.
- Backend calls to Swoogo and SendGrid always resolve config from the selected event, never from global hardcoded values.
- Rotating one event's SendGrid or Swoogo secret does not affect any other event.

## Epic 4: Idempotent Transactions And State Changes

**Goal:** Prevent duplicate badges, duplicate check-ins, duplicate messages, and inconsistent counters under retries or concurrent operators.

**Tasks**

- Build transaction helpers for:
  - participant import and upsert;
  - manual registration completion after Swoogo creation;
  - pre-check-in, queue assignment, credential reservation, and print-job creation;
  - print-job claim, success, and failure;
  - badge delivery;
  - credential reissue and old-badge voiding;
  - session check-in and Swoogo sync status;
  - gate scan and area movement;
  - message-job creation and provider submission status.
- Use deterministic IDs or explicit `idempotencyKey` fields for external calls and retryable operations.
- Keep queue metrics updates in the same transaction as queue-entry and print-job changes.
- Enforce one active credential pointer per participant through `participants/{registrantId}.credentialing.activeBadgeId` and transaction preconditions.
- Require explicit admin override paths for exceptional states, such as restoring a voided credential.
- Record retry attempts, last error, and dead-letter status for print jobs, message jobs, and sync jobs.

**Dependencies:** Epics 1, 2, and 3 for workflows that call external providers.

**Acceptance Criteria**

- Repeating the same pre-check-in request returns the existing participant state without creating another credential or print job.
- Concurrent print terminals cannot claim the same print job.
- Reissuing a badge voids the previous active credential and creates the replacement in one transaction.
- Repeating a session scan does not create duplicate local check-ins or duplicate Swoogo submissions.
- Failed provider calls can be retried without corrupting participant, credential, queue, or stats state.

## Epic 5: Audit Logs

**Goal:** Provide a complete event-scoped operational history for security review, support, and reconciliation.

**Tasks**

- Implement a central audit writer used by every sensitive backend mutation.
- Store audit records at `events/{eventId}/auditLogs/{auditLogId}` with:
  - `actorUid`, `actorRole`, and membership snapshot;
  - `terminalId` or `deviceId` when present;
  - `action`, `result`, `resourceType`, `resourceId`;
  - request ID or idempotency key;
  - before/after status fields where useful;
  - sanitized external provider response summaries;
  - `createdAt`.
- Audit at minimum:
  - imports, manual registrations, pre-check-ins, queue assignments;
  - credential reserved, issued, delivered, voided, reissued, and cancelled-scan detected;
  - print claim, success, failure, reprint;
  - SendGrid request, delivery, bounce, drop, and failure;
  - session check-in and Swoogo sync result;
  - gate access allowed, denied, blocked, and area movement;
  - access override create, update, delete;
  - role changes;
  - Swoogo and SendGrid config tests or changes.
- Make audit logs append-only to clients and immutable after creation except for backend retention/export markers.
- Define retention, export, and redaction rules for PII-heavy metadata.

**Dependencies:** Epics 1 and 2; should be added before broad workflow rollout.

**Acceptance Criteria**

- Every MVP mutation creates exactly one primary audit record, plus provider/audit child records when needed.
- Audit logs never include raw Swoogo or SendGrid secrets.
- Support can trace a badge from reservation through delivery, void, or reissue using audit records.
- Security can trace denied or cancelled badge scans by operator, device, area, and credential.

## Epic 6: Area Permissions And Current Occupancy

**Goal:** Enforce area access rules and maintain reliable current-area state without Swoogo side effects.

**Tasks**

- Implement credential QR parsing for `BADGEID;epochSeconds;SWOOGOID`.
- Validate that the credential exists under the selected event, matches the participant, and has an allowed status.
- Implement area permission evaluation in this order:
  1. block malformed, missing, cross-event, inactive, or void credentials;
  2. deny valid individual overrides with `decision = deny`;
  3. allow valid individual overrides with `decision = allow`;
  4. deny matching `deniedRegistrationTypeIds`;
  5. allow matching `allowedRegistrationTypeIds`;
  6. fall back to `defaultDecision`.
- For allowed gate scans, write both:
  - `events/{eventId}/areaPassages/{passageId}`;
  - `events/{eventId}/participants/{registrantId}/accessPassages/{passageId}`.
- Update `participants/{registrantId}.presence.currentAreaId` in the same transaction as the allowed passage.
- Store `fromAreaId`, `toAreaId`, gate, operator, device, credential, result, reason, and source on every passage.
- Ensure denied and blocked scans are logged but do not update current occupancy.
- For linked session check-ins, record `source = session_checkin` area passages and avoid creating a second Swoogo session scan.
- Compute current occupancy from participant presence, not by summing passage history.
- Add a reconciliation job that recalculates area counts from participants and compares them to `stats/areas`.

**Dependencies:** Epics 1, 2, 4, and 5.

**Acceptance Criteria**

- A void badge returns the blocking cancelled-badge result and cannot pass gate or session validation.
- A participant can have only one `presence.currentAreaId` at a time.
- Area overrides take precedence over registration-type rules.
- Current area occupancy matches the count of participants whose `presence.currentAreaId` equals the area ID after reconciliation.
- Gate scans never call Swoogo session scan endpoints.

## Epic 7: Dashboard Aggregates And Queue-Time Metrics

**Goal:** Serve live operational dashboards from aggregate documents instead of expensive event-wide scans.

**Tasks**

- Create aggregate documents:
  - `events/{eventId}/stats/current`;
  - `events/{eventId}/stats/queues`;
  - `events/{eventId}/stats/sessions`;
  - `events/{eventId}/stats/areas`;
  - `events/{eventId}/stats/timeBuckets/{bucketId}`.
- Maintain participant totals:
  - Swoogo registered;
  - locally imported;
  - manual registrations;
  - pre-checked;
  - badges issued;
  - badges delivered;
  - cancelled badges;
  - participants without credentials.
- Maintain queue metrics from timestamp pairs:
  - `precheckedAt -> printedAt`;
  - `printedAt -> deliveredAt`;
  - `precheckedAt -> deliveredAt`.
- Calculate average, P50, P90, P95, and max by queue, registration type, and 5-minute or 15-minute bucket.
- Maintain session metrics from `sessionCheckins` and Swoogo session snapshots.
- Maintain area metrics from participant presence and `areaPassages`, including current occupancy, allowed passages, denied passages, cancelled badge scans, unique participants, registration-type breakdown, and time buckets.
- Maintain email metrics from `messageJobs` and SendGrid webhook events.
- Build a dashboard API that reads stats documents and returns `lastUpdatedAt`, `isStale`, and source reconciliation status.
- Add a backfill/recompute job for stats after deploys, imports, or incident recovery.

**Dependencies:** Epics 1, 4, 5, and 6.

**Acceptance Criteria**

- Dashboard endpoints do not scan all participants, credentials, area passages, or message jobs on each request.
- Queue-time metrics are available by queue, registration type, and time bucket.
- Area occupancy uses current participant presence, while area traffic uses passage history.
- Stats can be rebuilt from source collections and match live aggregates within an agreed tolerance.

## Epic 8: Monitoring, Reconciliation, And Operations

**Goal:** Detect stuck workflows, provider drift, and event data inconsistencies early.

**Tasks**

- Add terminal heartbeat records and alerts for print terminals and mobile devices.
- Alert on:
  - printer heartbeat missing for more than 60 seconds;
  - jobs stuck in `printing` longer than the event threshold;
  - queue depth above threshold;
  - repeated print failures by terminal;
  - Swoogo HTTP error rate above threshold;
  - SendGrid failure, bounce, or drop rate above threshold;
  - repeated credential reissues for one participant;
  - repeated cancelled-badge scans;
  - unusual denied gate access rate.
- Implement `syncJobs` for:
  - Swoogo registrant reconciliation;
  - Swoogo session scan reconciliation;
  - SendGrid webhook reconciliation;
  - credential state consistency;
  - queue metric consistency;
  - area occupancy consistency.
- Add dead-letter handling for message jobs, print jobs, and sync jobs with operator-visible remediation fields.
- Build reconciliation reports comparing:
  - Swoogo registered count vs local participants;
  - Swoogo session scans vs local `sessionCheckins`;
  - active participant credential pointer vs credential documents;
  - queue counters vs queue entries and print jobs;
  - stats area occupancy vs participant presence;
  - SendGrid provider status vs message job status.
- Emit structured logs with `eventId`, `requestId`, `actorUid`, `terminalId`, provider, operation, status, and latency.

**Dependencies:** Epics 1, 4, 5, 6, and 7.

**Acceptance Criteria**

- Operations can identify stuck print, email, sync, and gate workflows without querying raw collections manually.
- Reconciliation jobs produce actionable differences with resource IDs and suggested repair actions.
- Provider error alerts are scoped to the affected event and integration.
- Dead-lettered work can be retried or closed with an audited reason.

## Cross-Epic Definition Of Done

- All event data paths are structurally scoped below `events/{eventId}` unless intentionally global.
- Backend authorization checks happen before reads, writes, or provider calls.
- Firestore Security Rules enforce least privilege even if a client calls Firestore directly.
- Raw Swoogo and SendGrid secrets are never readable by clients.
- Retryable operations have idempotency keys or deterministic document IDs.
- Sensitive mutations write audit logs.
- Dashboard data can be recalculated from source-of-truth collections.
- Reconciliation jobs can detect drift between Firestore, Swoogo, SendGrid, and aggregate stats.
