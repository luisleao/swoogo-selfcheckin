# Firestore Model Contract

This contract covers the first data/security backlog slice for the Swoogo self-checkin system. It defines the event-isolated Firestore paths, required operational fields, status enums, deterministic IDs, owner services, and index expectations used by backend, frontend, printing, and analytics work.

## Design Rules

- The system uses the named Firestore database `attendee-registry`; it must not store operational credentialing data in the project `(default)` database.
- Multi-event isolation is structural. Operational data lives under `events/{eventId}` and must never be queried from a global operational collection.
- Every operational document under an event must include `eventId`, even though the path already scopes it. This makes logs, exports, rules, and debugging safer.
- Every operational document should include `createdAt`, `updatedAt`, and actor fields such as `createdBy`, `updatedBy`, `operatorUid`, `terminalId`, or `deviceId` when the value exists.
- Sensitive state changes are backend-owned. Clients may read allowed event-scoped data, but credentials, print jobs, queue entries, session check-ins, gate passages, message jobs, stats, audit logs, role documents, and integration settings are written by the backend through audited routes or workers using trusted server credentials.
- Raw Swoogo and SendGrid secrets are not stored in client-readable documents. Secret Manager is the primary secret store. If Firestore must hold encrypted fallback material, it must live in backend-only paths denied by Firestore Security Rules.
- Deterministic IDs are required where retries can create duplicates. Random auto IDs are required for printed credential badge IDs.

## Common Field Types

| Field | Type | Notes |
| --- | --- | --- |
| `eventId` | string | Required on event-scoped operational docs. Must equal the path `eventId`. |
| `createdAt` | timestamp | Server timestamp at create time. |
| `updatedAt` | timestamp | Server timestamp at last update. |
| `createdBy` | string or null | Firebase UID or backend service id. |
| `updatedBy` | string or null | Firebase UID or backend service id. |
| `operatorUid` | string or null | Firebase UID for a human operator action. |
| `terminalId` | string or null | Print, pre-checkin, gate, or mobile terminal id. |
| `deviceId` | string or null | Device id when different from terminal id. |
| `requestId` | string or null | Backend request correlation id. |
| `idempotencyKey` | string or null | Stable key for retryable operations. |

## Deterministic IDs

| Path | ID rule |
| --- | --- |
| `events/{eventId}/participants/{registrantId}` | Swoogo registrant id as a string. Manual registrations are written only after Swoogo returns the registrant id. |
| `events/{eventId}/printJobs/{jobId}` | Initial badge print job uses `badge-{registrantId}`. Reprints use a stable event-scoped idempotency key such as `reissue-{oldBadgeId}-{requestId}`. |
| `events/{eventId}/credentials/{badgeId}` | Firestore auto ID. This is the `BADGEID` in the credential QR payload and must not be predictable. |
| `events/{eventId}/sessionCheckins/{sessionId_registrantId}` | `{sessionId}_{registrantId}`. |
| `events/{eventId}/messageJobs/{messageJobId}` | `{purpose}_{registrantId}` or another stable event-scoped idempotency key. |
| `events/{eventId}/syncJobs/{syncJobId}` | `{provider}_{jobType}_{timeBucket}` for scheduled syncs. |
| `events/{eventId}/areaPassages/{passageId}` | Backend-generated idempotency key for retries, otherwise auto ID. |
| `events/{eventId}/participants/{registrantId}/accessPassages/{passageId}` | Same `passageId` as the event-level area passage. |

## Status Enums

| Entity | Values | Legal transitions |
| --- | --- | --- |
| Participant credentialing | `imported`, `prechecked`, `queued`, `printing`, `printed`, `delivered`, `print_failed`, `cancelled` | `imported -> prechecked -> queued -> printing -> printed -> delivered`; `queued -> print_failed -> queued`; `printing -> print_failed -> queued`; any active state may move to `cancelled` by an audited backend action. |
| Credential | `reserved`, `printing`, `issued`, `delivered`, `failed`, `void` | `reserved -> printing -> issued -> delivered`; `printing -> failed`; `issued -> void`; `delivered -> void`; `failed -> reserved` only through an audited retry or reissue flow. |
| Print job | `queued`, `claimed`, `printing`, `printed`, `print_failed`, `cancelled`, `dead_letter` | `queued -> claimed -> printing -> printed`; `queued/claimed/printing -> print_failed -> queued`; repeated failures may move to `dead_letter`; `queued/claimed/printing -> cancelled` by backend. |
| Queue entry | `waiting`, `printing`, `ready_for_pickup`, `delivered`, `cancelled`, `expired` | `waiting -> printing -> ready_for_pickup -> delivered`; any non-final state may move to `cancelled` or `expired`. |
| Message job | `pending`, `sending`, `sent`, `delivered`, `deferred`, `bounced`, `dropped`, `failed`, `dead_letter`, `cancelled` | `pending -> sending -> sent`; provider webhooks may move `sent -> delivered/deferred/bounced/dropped`; retryable failures move `sending -> failed -> pending`; repeated failures move to `dead_letter`; unsent jobs may be `cancelled`. |
| Session check-in | `pending_sync`, `synced`, `duplicate`, `failed`, `blocked`, `cancelled` | `pending_sync -> synced`; duplicate scans resolve to `duplicate`; invalid credential or permission failures resolve to `blocked`; provider errors resolve to `failed` and may retry to `pending_sync`. |
| Sync job | `queued`, `running`, `succeeded`, `failed`, `dead_letter`, `cancelled` | `queued -> running -> succeeded`; `running -> failed -> queued`; repeated failures move to `dead_letter`; queued/running may be `cancelled` by backend. |
| Area passage | `allowed`, `denied`, `blocked` | Final at creation time. `allowed` may update participant presence; `denied` and `blocked` must not. |
| Event/member/config docs | `draft`, `active`, `paused`, `archived`, `inactive` as applicable | Config transitions are backend-owned and audited. |

## Collection Contracts

### `users/{uid}`

Owner: backend auth service.

Purpose: Global user profile and small global flags. Event membership is not stored here.

Required fields:

- `uid`
- `email`
- `displayName`
- `status`: `active`, `inactive`, or `disabled`
- `globalRoles`: small global role list only, such as `viewer`
- `createdAt`
- `updatedAt`

Forbidden fields:

- Per-event role lists.
- Swoogo or SendGrid secrets.

### `events/{eventId}`

Owner: backend event service.

Purpose: Event identity, safe operational metadata, defaults, and non-secret integration metadata.

Required fields:

- `eventId`
- `name`
- `registration`: `true` when the event is enabled for credentialing workflows
- `slug`
- `timezone`
- `status`: `draft`, `active`, `paused`, or `archived`
- `swoogo.enabled`
- `swoogo.baseUrl`
- `swoogo.eventId`
- `swoogo.authMode`
- `swoogo.secretStatus.configured`
- `sendgrid.enabled`
- `sendgrid.defaultIntegrationId`
- `sendgrid.integrations.{integrationId}.label`
- `sendgrid.integrations.{integrationId}.fromEmail`
- `sendgrid.integrations.{integrationId}.fromName`
- `sendgrid.integrations.{integrationId}.replyToEmail`
- `sendgrid.integrations.{integrationId}.enabled`
- `defaults.queueId`
- `defaults.badgeLayoutId`
- `createdAt`
- `updatedAt`

Backend-only secret reference fields must not be placed on this client-readable event document. If a Secret Manager resource name or encrypted fallback value must be persisted in Firestore, use a backend-only path such as `events/{eventId}/integrationSecrets/{secretId}` and deny all direct client reads and writes.

Events can exist under `/events/{eventId}` before credentialing is enabled. The admin event setup flow converts an existing event into a credentialing event by setting `registration = true`, preserving the slug document ID, and adding the required safe defaults and integration metadata. Event listing endpoints and direct client reads must only expose `/events` documents with `registration = true` unless the user is a `super_admin` or an active event member.

### `events/{eventId}/members/{uid}`

Owner: backend authorization service.

Purpose: Event-specific roles and resource scopes.

Required fields:

- `eventId`
- `uid`
- `roles`: array of role names
- `allowedQueueIds`: array
- `allowedSessionIds`: array
- `allowedAreaIds`: array
- `allowedGateIds`: array
- `status`: `active` or `inactive`
- `createdAt`
- `updatedAt`
- `createdBy`
- `updatedBy`

Role names:

- `super_admin`: Custom claim only, not an event membership role for normal users.
- `event_admin`
- `event_manager`
- `precheckin_operator`
- `print_operator`
- `credential_reissuer`
- `session_operator`
- `gate_operator`
- `area_manager`
- `viewer`

### `events/{eventId}/participants/{registrantId}`

Owner: backend participant lifecycle service.

Purpose: Local participant snapshot, credentialing state, Swoogo identifiers, area presence, and search fields.

Required fields:

- `eventId`
- `participantId`
- `swoogoRegistrantId`
- `swoogoEventId`
- `registrationTypeId`
- `registrationTypeName`
- `email`
- `normalizedEmail`
- `firstName`
- `lastName`
- `fullName`
- `company`
- `jobTitle`
- `registrationStatus`
- `sessionIds`
- `credentialing.status`
- `credentialing.precheckedAt`
- `credentialing.precheckedBy`
- `credentialing.queueId`
- `credentialing.printJobId`
- `credentialing.activeBadgeId`
- `credentialing.activeCredentialId`
- `credentialing.deliveredAt`
- `credentialing.deliveredBy`
- `presence.currentAreaId`
- `presence.currentAreaName`
- `presence.currentAreaEnteredAt`
- `source.system`
- `source.manualRegistration`
- `source.lastSyncedAt`
- `createdAt`
- `updatedAt`

Indexes:

- `normalizedEmail`
- `credentialing.status`
- `registrationTypeId`
- `presence.currentAreaId`
- `source.manualRegistration`

### `events/{eventId}/registrantTypes/{registrationTypeId}`

Owner: backend Swoogo sync service.

Purpose: Event registration type lookup and queue/access mapping.

Required fields:

- `eventId`
- `registrationTypeId`
- `swoogoRegistrationTypeId`
- `name`
- `status`
- `defaultQueueId`
- `defaultBadgeLayoutId`
- `createdAt`
- `updatedAt`

### `events/{eventId}/queues/{queueId}`

Owner: backend queue allocator.

Purpose: Badge pickup and print routing queue.

Required fields:

- `eventId`
- `queueId`
- `name`
- `status`: `active`, `paused`, or `archived`
- `acceptedRegistrationTypeIds`
- `priority`
- `terminalIds`
- `metrics.pending`
- `metrics.printing`
- `metrics.readyForPickup`
- `metrics.delivered`
- `metrics.lastAssignedAt`
- `createdAt`
- `updatedAt`

### `events/{eventId}/queueEntries/{entryId}`

Owner: backend queue allocator and pickup service.

Purpose: Per-participant queue state and timing.

Required fields:

- `eventId`
- `queueEntryId`
- `participantId`
- `queueId`
- `printJobId`
- `credentialBadgeId`
- `status`
- `priority`
- `enteredAt`
- `readyAt`
- `deliveredAt`
- `cancelledAt`
- `createdAt`
- `updatedAt`

Indexes:

- `status + queueId + createdAt`
- `participantId + createdAt`

### `events/{eventId}/printTerminals/{terminalId}`

Owner: backend terminal registry and print worker.

Purpose: Registered print terminal capabilities, queue scope, and heartbeat.

Required fields:

- `eventId`
- `terminalId`
- `name`
- `status`: `active`, `inactive`, or `disabled`
- `queueIds`
- `printerName`
- `workerVersion`
- `lastSeenAt`
- `lastClaimedJobId`
- `createdAt`
- `updatedAt`

### `events/{eventId}/printJobs/{jobId}`

Owner: backend credentialing service and print worker.

Purpose: Durable print queue item for local workers.

Required fields:

- `eventId`
- `printJobId`
- `participantId`
- `queueId`
- `terminalId`
- `layoutId`
- `credentialBadgeId`
- `credentialId`
- `status`
- `attempts`
- `priority`
- `claimedAt`
- `printedAt`
- `failedAt`
- `error`
- `payloadSnapshot.credentialQrPayload`
- `payloadSnapshot.fullName`
- `payloadSnapshot.firstName`
- `payloadSnapshot.company`
- `payloadSnapshot.jobTitle`
- `createdAt`
- `updatedAt`

Indexes:

- `status + queueId + priority + createdAt`
- `terminalId + status + claimedAt`

### `events/{eventId}/credentials/{badgeId}`

Owner: backend credentialing service.

Purpose: Physical badge credential identity and lifecycle.

Required fields:

- `eventId`
- `badgeId`
- `credentialId`
- `qrPayload`
- `participantId`
- `swoogoRegistrantId`
- `issuedAtEpochSeconds`
- `status`
- `printJobId`
- `queueId`
- `terminalId`
- `layoutId`
- `issuedAt`
- `issuedBy`
- `deliveredAt`
- `deliveredBy`
- `voidedAt`
- `voidedBy`
- `voidReason`
- `reissueOfBadgeId`
- `reissueOfCredentialId`
- `replacedByBadgeId`
- `replacedByCredentialId`
- `createdAt`
- `updatedAt`

Indexes:

- `participantId + status`
- `credentialId`
- `swoogoRegistrantId + status`
- `status + issuedAt`

### `events/{eventId}/badgeLayouts/{layoutId}`

Owner: backend configuration service and badge editor.

Purpose: Versioned badge layout definition.

Required fields:

- `eventId`
- `layoutId`
- `name`
- `status`: `draft`, `published`, `archived`
- `version`
- `registrationTypeIds`
- `size.widthMm`
- `size.heightMm`
- `dpi`
- `fields`
- `createdAt`
- `updatedAt`
- `publishedAt`
- `publishedBy`

Published layouts are backend-owned to prevent clients from altering printed credential content without audit.

### `events/{eventId}/sessions/{sessionId}`

Owner: backend Swoogo sync service and session operations.

Purpose: Swoogo session snapshot and local check-in configuration.

Required fields:

- `eventId`
- `sessionId`
- `swoogoSessionId`
- `swoogoEventId`
- `name`
- `date`
- `startTime`
- `endTime`
- `capacity`
- `accessAreaId`
- `accessAreaName`
- `enforceAreaPermissionForSessions`
- `status`: `active`, `paused`, `archived`, or `cancelled`
- `lastSyncedAt`
- `createdAt`
- `updatedAt`

Indexes:

- `date + startTime + status`
- `accessAreaId + date`

### `events/{eventId}/sessionCheckins/{sessionId_registrantId}`

Owner: backend session check-in service.

Purpose: Idempotent local record of a Swoogo session scan and optional linked area movement.

Required fields:

- `eventId`
- `sessionCheckinId`
- `sessionId`
- `registrantId`
- `participantId`
- `credentialBadgeId`
- `credentialId`
- `accessAreaId`
- `areaPassageId`
- `operatorUid`
- `deviceId`
- `status`
- `swoogoScanId`
- `checkedInAt`
- `syncedAt`
- `error`
- `createdAt`
- `updatedAt`

Indexes:

- `sessionId + registrantId`
- `status + checkedInAt`
- `operatorUid + checkedInAt`

### `events/{eventId}/accessAreas/{areaId}`

Owner: backend area access service.

Purpose: Controlled area configuration and occupancy snapshot.

Required fields:

- `eventId`
- `areaId`
- `name`
- `status`: `active`, `inactive`, or `archived`
- `type`
- `allowedRegistrationTypeIds`
- `deniedRegistrationTypeIds`
- `allowedBadgeStatuses`
- `participantOverrideMode`
- `defaultDecision`: `allow` or `deny`
- `occupancy.currentCount`
- `occupancy.lastRecalculatedAt`
- `createdAt`
- `updatedAt`

### `events/{eventId}/accessAreas/{areaId}/participantOverrides/{registrantId}`

Owner: backend area access service.

Purpose: Participant-specific allow/deny override for one access area.

Required fields:

- `eventId`
- `areaId`
- `participantId`
- `decision`: `allow` or `deny`
- `reason`
- `validFrom`
- `validUntil`
- `createdBy`
- `createdAt`
- `updatedBy`
- `updatedAt`

Indexes:

- Collection group `participantId`
- Collection group `decision + validUntil`

### `events/{eventId}/gates/{gateId}`

Owner: backend area access service.

Purpose: Scanner checkpoint assigned to a target controlled area.

Required fields:

- `eventId`
- `gateId`
- `name`
- `status`: `active`, `inactive`, or `archived`
- `targetAreaId`
- `mode`: `entry_only`, `exit_only`, or `entry_exit`
- `operatorRole`
- `allowRepeatedEntry`
- `denyCancelledCredentials`
- `createdAt`
- `updatedAt`

Indexes:

- `status`
- `targetAreaId`

### `events/{eventId}/areaPassages/{passageId}`

Owner: backend gate and session check-in services.

Purpose: Event-level passage attempt log.

Required fields:

- `eventId`
- `passageId`
- `gateId`
- `targetAreaId`
- `fromAreaId`
- `toAreaId`
- `participantId`
- `swoogoRegistrantId`
- `credentialBadgeId`
- `credentialId`
- `operatorUid`
- `deviceId`
- `direction`
- `result`: `allowed`, `denied`, or `blocked`
- `reason`
- `source`: `gate_scan`, `session_checkin`, or `admin_adjustment`
- `scannedAt`
- `metadata`
- `createdAt`

Indexes:

- `targetAreaId + scannedAt`
- `participantId + scannedAt`
- `credentialBadgeId + scannedAt`
- `result + scannedAt`
- `source + scannedAt`
- `gateId + scannedAt`

### `events/{eventId}/participants/{registrantId}/accessPassages/{passageId}`

Owner: backend gate and session check-in services.

Purpose: Participant-local copy of passage history for detail views.

Required fields: Same as `areaPassages`, plus `participantId` must equal `{registrantId}`.

Indexes:

- Collection group `participantId + scannedAt`
- Collection group `targetAreaId + scannedAt`
- Collection group `gateId + scannedAt`
- Collection group `result + scannedAt`

### `events/{eventId}/messageJobs/{messageJobId}`

Owner: backend messaging service.

Purpose: Idempotent SendGrid job, provider submission state, webhook state, and retry metadata.

Required fields:

- `eventId`
- `messageJobId`
- `participantId`
- `registrantId`
- `provider`: `sendgrid`
- `channel`: `email`
- `to`
- `fromEmail`
- `fromName`
- `templateId`
- `templatePurpose`
- `status`
- `attempts`
- `providerMessageId`
- `integrationSnapshot`
- `qrPayload`
- `qrImageUrl`
- `lastError`
- `sentAt`
- `deliveredAt`
- `createdAt`
- `updatedAt`

The `integrationSnapshot` may include integration id, sender metadata, template id, and redacted version labels. It must not include raw API keys, encrypted secret bytes, or OAuth secrets.

Indexes:

- `status + createdAt`
- `provider + providerMessageId`
- `templatePurpose + status`

### `events/{eventId}/sendgridTemplates/{templateConfigId}`

Owner: backend messaging configuration service.

Purpose: Event-specific safe template mapping by purpose.

Required fields:

- `eventId`
- `templateConfigId`
- `purpose`
- `integrationId`
- `templateId`
- `enabled`
- `versionLabel`
- `createdAt`
- `updatedAt`
- `createdBy`
- `updatedBy`

No API keys or webhook signing secrets are allowed in this collection.

Indexes:

- `purpose + enabled`
- `integrationId + enabled`

### `events/{eventId}/syncJobs/{syncJobId}`

Owner: backend Swoogo sync service.

Purpose: Import/export job status, retries, provider snapshots, and reconciliation metadata.

Required fields:

- `eventId`
- `syncJobId`
- `provider`: `swoogo` or `sendgrid`
- `jobType`
- `timeBucket`
- `status`
- `attempts`
- `startedAt`
- `completedAt`
- `lastError`
- `integrationSnapshot`
- `createdAt`
- `updatedAt`

Indexes:

- `provider + jobType + status + createdAt`
- `status + createdAt`

### `events/{eventId}/auditLogs/{auditLogId}`

Owner: backend audit service.

Purpose: Append-only event-scoped operational history for sensitive mutations.

Required fields:

- `eventId`
- `auditLogId`
- `actorUid`
- `actorRole`
- `membershipSnapshot`
- `terminalId`
- `deviceId`
- `action`
- `result`
- `resourceType`
- `resourceId`
- `requestId`
- `idempotencyKey`
- `beforeStatus`
- `afterStatus`
- `providerSummary`
- `metadata`
- `createdAt`

Audit logs must not contain raw Swoogo or SendGrid secrets. PII-heavy metadata should be minimized and redacted for exports.

Indexes:

- `actorUid + createdAt`
- `action + createdAt`
- `resourceType + resourceId + createdAt`

### `events/{eventId}/stats/current`

Owner: backend analytics writer.

Purpose: Current event-wide dashboard counters.

Required fields:

- `eventId`
- `participantTotals`
- `credentialingTotals`
- `queueTotals`
- `sessionTotals`
- `areaTotals`
- `messageTotals`
- `updatedAt`
- `updatedBy`

### `events/{eventId}/stats/queues`

Owner: backend analytics writer.

Purpose: Queue-level current counters and timing rollups.

Required fields:

- `eventId`
- `queues`
- `averageWaitSeconds`
- `percentiles`
- `updatedAt`
- `updatedBy`

### `events/{eventId}/stats/sessions`

Owner: backend analytics writer.

Purpose: Session check-in totals and sync health.

Required fields:

- `eventId`
- `sessions`
- `totals`
- `updatedAt`
- `updatedBy`

### `events/{eventId}/stats/areas`

Owner: backend analytics writer.

Purpose: Area occupancy and access result totals.

Required fields:

- `eventId`
- `areas`
- `totals`
- `reconciledAt`
- `updatedAt`
- `updatedBy`

### `events/{eventId}/stats/timeBuckets/{bucketId}`

Owner: backend analytics writer.

Purpose: Time-series queue, credentialing, session, area, and message metrics.

Required fields:

- `eventId`
- `bucketId`
- `bucketStartAt`
- `bucketEndAt`
- `granularity`
- `metrics`
- `createdAt`
- `updatedAt`

## Secret Reference Contract

Secret Manager references are versioned resource names, for example:

```text
projects/{projectId}/secrets/sendgrid-api-key-{eventId}/versions/latest
projects/{projectId}/secrets/swoogo-consumer-key-{eventId}/versions/3
projects/{projectId}/secrets/swoogo-consumer-secret-{eventId}/versions/3
```

The backend may store these references in server configuration or a backend-only Firestore path such as `events/{eventId}/integrationSecrets/{secretId}`. Client-readable event and template documents expose only safe metadata such as `configured`, `integrationId`, `templateId`, sender fields, last test status, and redacted version labels.

## Index Manifest

The initial composite index manifest lives in `firestore.indexes.json`. Indexes are scoped by collection id and are intended for queries rooted at `events/{eventId}` or explicit collection-group analytics queries. Backend and frontend code must include the event path in operational queries so indexes do not become cross-event scans.
