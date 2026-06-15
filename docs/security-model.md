# Security Model

This model covers Firebase Auth, event memberships, roles, resource scopes, secret isolation, backend-owned writes, and Firestore Security Rules for the first data/security backlog slice.

## Principles

- Default deny at the Firestore layer.
- Firebase Auth identifies every human user and terminal account; the current human login method is email/password.
- Custom claims are small and global. They do not contain per-event role lists.
- Event roles and resource scopes live in `events/{eventId}/members/{uid}`.
- `BOOTSTRAP_EVENT_MANAGER_UIDS` may grant a small set of Firebase Auth UIDs the global `event_manager` role for first-event setup. After bootstrap, normal event-scoped membership should be used.
- Event membership must be active before a user can read event-scoped operational data.
- Event documents under `/events` can be listed by clients only when `registration = true` and the document contains no sensitive integration fields; event creation and registration activation remain backend-only.
- Sensitive mutations go through backend routes or trusted workers using server credentials. Direct client writes are denied until a narrower, tested write rule is intentionally added.
- Firestore Security Rules cannot redact individual fields from a readable document. Any raw secret, encrypted secret, or backend-only secret reference must not live in a document that clients can read directly.

## Firebase Auth Custom Claims

Allowed custom claims:

- `superAdmin: true`: Global break-glass and platform administration access.
- `terminal: true`: Optional marker for terminal service accounts. Terminal authorization still comes from event membership and resource scope fields.
- Small global flags such as `disabled`, `support`, or `internalTester` if needed later.

Forbidden custom claims:

- Per-event role maps.
- Lists of event ids a user can access.
- Swoogo, SendGrid, or provider credentials.
- Queue, session, or area scope lists.

Reason: custom claims are cached in ID tokens, have size limits, and are hard to revoke instantly. Event access must be resolved from Firestore membership documents.

## Event Memberships

Path: `events/{eventId}/members/{uid}`

Membership fields:

- `eventId`
- `uid`
- `status`: `active` or `inactive`
- `roles`
- `allowedQueueIds`
- `allowedSessionIds`
- `allowedAreaIds`
- `createdAt`
- `updatedAt`
- `createdBy`
- `updatedBy`

Rules:

- A missing member document means no event access.
- `status != active` means no event access.
- Resource scope arrays limit operator access for queues, sessions, and areas.
- Role changes are backend-owned and audited.
- Users may read their own active membership so clients can shape navigation.
- Event admins and event managers may read member lists for management screens, but writes still go through backend routes.

## Roles

| Role | Purpose | Notes |
| --- | --- | --- |
| `super_admin` | Global platform administration | Represented by custom claim `superAdmin: true`; not stored as broad per-event lists. |
| `event_admin` | Full administration for one event | Can configure event settings through backend APIs and read most event data. |
| `event_manager` | Operational management for one event | Can manage event operations without global user control. |
| `precheckin_operator` | Pre-check-in terminals | Scoped by `allowedQueueIds` when reading queue-linked documents. |
| `print_operator` | Print worker and badge pickup | Scoped by `allowedQueueIds` and terminal membership. |
| `credential_reissuer` | Badge void/reissue workflows | Reissue requires backend API, reason, and audit log. |
| `session_operator` | Mobile session check-in | Scoped by `allowedSessionIds`; linked areas may also require area scope. |
| `gate_operator` | Controlled-area access scans | Scoped by `allowedAreaIds` and selected area. |
| `area_manager` | Area rules and participant overrides | Scoped by `allowedAreaIds` where possible. |
| `viewer` | Dashboards and reports | Read-only; no direct operational writes. |

## Route-To-Role Matrix

This matrix is the authorization target for backend routes. Firestore rules provide a second layer of read isolation and deny sensitive client writes.

| Capability | Roles |
| --- | --- |
| Event list/detail | Any active event member; `super_admin` for all events |
| User profile read | Self; `super_admin` |
| Membership read | Self, `event_admin`, `event_manager`, `super_admin` |
| Membership create/update/delete | `event_admin`, `super_admin` through backend only |
| Event config read | `event_admin`, `event_manager`, `viewer`, `super_admin`; secret values redacted |
| Event config write | `event_admin`, `super_admin` through backend only |
| Swoogo config/test/sync | `event_admin`, `event_manager`, `super_admin` through backend only |
| SendGrid config/test/send | `event_admin`, `event_manager`, `super_admin` through backend only |
| Participant search/read | `event_admin`, `event_manager`, `precheckin_operator`, `print_operator`, `credential_reissuer`, `session_operator`, `gate_operator`, `area_manager`, `viewer`, `super_admin` |
| Participant import/manual registration | `event_admin`, `event_manager`, `precheckin_operator`, `super_admin` through backend only |
| Pre-check-in | `precheckin_operator`, `event_admin`, `event_manager`, `super_admin` through backend only |
| Queue read | `event_admin`, `event_manager`, `precheckin_operator`, `print_operator`, `viewer`, `super_admin`; operators scoped by `allowedQueueIds` |
| Queue assignment/write | Backend only after role and queue-scope checks |
| Print job read | `event_admin`, `event_manager`, `print_operator`, `viewer`, `super_admin`; print operators scoped by `allowedQueueIds` |
| Print job claim/complete/fail | `print_operator`, `event_admin`, `event_manager`, `super_admin` through backend or trusted worker only |
| Credential read | `event_admin`, `event_manager`, `print_operator`, `credential_reissuer`, `session_operator`, `gate_operator`, `viewer`, `super_admin` |
| Credential reserve/issue/deliver/void/reissue | Backend only; reissue additionally requires `credential_reissuer` or `event_admin` |
| Badge layout read | Active event members |
| Badge layout publish/update | `event_admin`, `event_manager`, `super_admin` through backend only |
| Session read | `event_admin`, `event_manager`, `session_operator`, `viewer`, `super_admin`; session operators scoped by `allowedSessionIds` |
| Session check-in | `session_operator`, `event_admin`, `event_manager`, `super_admin` through backend only |
| Access area read | `event_admin`, `event_manager`, `area_manager`, `gate_operator`, `session_operator`, `viewer`, `super_admin`; scoped by `allowedAreaIds` where possible |
| Access area/override write | `area_manager`, `event_admin`, `event_manager`, `super_admin` through backend only |
| Area access scan | `gate_operator`, `event_admin`, `event_manager`, `super_admin` through backend only; gate operators scoped by `allowedAreaIds` |
| Message job read | `event_admin`, `event_manager`, `super_admin` |
| Message job create/send/webhook update | Backend only |
| Sync job read | `event_admin`, `event_manager`, `super_admin` |
| Sync job create/update | Backend only |
| Audit log read | `event_admin`, `event_manager`, `super_admin` |
| Audit log write | Backend only, append-only |
| Stats read | `event_admin`, `event_manager`, `viewer`, `super_admin` |
| Stats write | Backend analytics writer only |

## Resource Scopes

Resource scopes are enforced by backend authorization and reflected in initial Firestore read rules where the document shape supports it.

- Queue-scoped operators must have `queueId` in `allowedQueueIds` before reading queue entries or print jobs tied to that queue.
- Session operators must have `sessionId` in `allowedSessionIds` before reading or acting on session check-in data for that session.
- Area managers and scanner roles must have `areaId` in `allowedAreaIds` before managing or acting on an area where applicable.
- Gate operators must have the selected `areaId` in `allowedAreaIds` before scanning access for that area.
- `event_admin`, `event_manager`, and `super_admin` bypass resource-scope arrays for the event.

## Secret Isolation

Primary store:

- Use Google Secret Manager for raw Swoogo consumer keys, Swoogo consumer secrets, SendGrid API keys, and SendGrid webhook signing keys.
- Store each secret as an event-specific versioned reference, for example `projects/{projectId}/secrets/sendgrid-api-key-{eventId}/versions/latest`.
- Rotating one event's secret updates that event's secret version reference only.

Client-readable Firestore documents may include:

- `configured: true`
- integration id
- provider name
- sender email and sender name
- reply-to metadata
- SendGrid template id
- last connection test status
- redacted version labels such as `latest` or `version 3`

Client-readable Firestore documents must not include:

- Raw API keys.
- Raw Swoogo consumer keys or consumer secrets.
- OAuth access tokens or refresh tokens.
- Encrypted secret bytes.
- KMS ciphertext.
- Secret Manager resource names if the team treats resource names as sensitive operational metadata.

Encrypted Firestore fallback:

- Allowed only when Secret Manager is unavailable.
- Encrypt with KMS before write.
- Store in a backend-only path such as `events/{eventId}/integrationSecrets/{secretId}`.
- Deny all direct client reads and writes to the backend-only path.
- Backend APIs that expose configuration must redact raw and encrypted fields.

Integration snapshots:

- `messageJobs`, `syncJobs`, and `auditLogs` may store sanitized snapshots of the event config used by a provider call.
- Snapshots may include integration id, template id, sender metadata, base URL, provider event id, and redacted secret version labels.
- Snapshots must never include raw or encrypted secret values.

## Backend-Owned Sensitive Writes

The following writes are denied to direct clients by default and must go through backend routes, trusted workers, or Admin SDK jobs:

- `users/{uid}` except future tightly scoped profile updates.
- `events/{eventId}` event configuration and integration metadata.
- `events/{eventId}/members/{uid}` role and scope changes.
- `participants` imports, manual registrations, credentialing state, and presence updates.
- `registrantTypes` Swoogo sync updates.
- `queues` and `queueEntries` allocation state.
- `printTerminals` registration and heartbeat, unless a terminal-specific write rule is later added with tests.
- `printJobs` create, claim, complete, fail, cancel, and dead-letter transitions.
- `credentials` reserve, issue, deliver, void, and reissue transitions.
- `badgeLayouts` publish and version updates.
- `sessions` import/configuration and `sessionCheckins` writes.
- `accessAreas`, `participantOverrides`, `areaPassages`, and participant `accessPassages`.
- `messageJobs`, SendGrid webhook updates, and retry metadata.
- `sendgridTemplates` mappings.
- `syncJobs`.
- `auditLogs`.
- `stats`.
- `integrationSecrets` or any backend-only secret path.

## Firestore Rules Strategy

The initial `firestore.rules` file implements:

- Default deny.
- Self user-profile reads.
- Safe event and membership reads for active members.
- Event-scoped read helpers that require `resource.data.eventId == eventId` on operational docs.
- Role checks for participant, queue, print, session, area, message, audit, and stats reads.
- Resource scope checks for queue, session, and area documents where the data contains the scoped id.
- Event read guards that deny obvious top-level and known nested Swoogo/SendGrid raw or encrypted secret fields.
- Explicit direct-client write denial for sensitive documents.
- Explicit denial of backend-only secret placeholder paths.

The backend Admin SDK bypasses Firestore Security Rules. That is acceptable only for audited backend code paths with Firebase ID token validation, membership resolution, role checks, resource-scope checks, and request correlation.

## Required Rules Tests

The next data/security slice should add emulator tests for:

- User with one event membership cannot read another event by changing `eventId`.
- Inactive members cannot read event docs or operational subcollections.
- Missing member docs are denied.
- Users cannot write credentials, print jobs, queue entries, stats, audit logs, roles, or integration config directly.
- Print operators are denied print jobs outside `allowedQueueIds`.
- Session operators are denied session check-ins outside `allowedSessionIds`.
- Gate operators are denied access scans for areas outside `allowedAreaIds`.
- Area managers are denied areas outside `allowedAreaIds`.
- Raw or encrypted secret paths are denied.
- `superAdmin: true` can read operational data needed for support, but still writes through backend APIs.

## Residual Risks

- Firestore rules can protect documents and queries, but they cannot fully encode all status-transition rules. The backend transaction layer must enforce legal transitions.
- Query rules based on resource fields require clients to query with matching filters. Backend and frontend code must be written to satisfy those constraints.
- Direct client reads of event documents are safe only if the contract is followed and sensitive fields are not added to those documents later. The initial rules deny obvious secret field names, but they cannot deeply validate arbitrary dynamic integration maps.
- Rules tests are not present in this slice; the emulator suite should be added before broad client implementation.
