# Implementation Backlog

This backlog turns the architecture in `docs/automatic-event-credentialing.md` into implementation tracks. It is meant to be used as the coordination document for parallel agents and human review.

## Delivery Strategy

Build the system in vertical slices, but keep ownership boundaries clear:

- Backend/API owns Express routes, integrations, transactions, and server-side authorization.
- Frontend owns React/Vite applications and operator workflows.
- Data/Security owns Firestore shape, rules, indexes, audit, and analytics contracts.
- Printing/Deployment owns local workers, badge rendering, printer setup, and terminal operations.

Each track can move independently only after the shared contracts are stable enough: event model, participant model, credential model, role model, and API route names.

## Definition Of Ready

A task is ready when:

- required data models are named;
- owner track is clear;
- dependencies are listed;
- acceptance criteria are testable;
- security and audit expectations are known;
- affected interfaces or endpoints are named.

## Definition Of Done

A task is done when:

- code or documentation is merged into the correct owner path;
- tests or verification notes exist;
- Firestore/security implications are documented;
- audit events are emitted for sensitive mutations;
- error states are handled;
- the implementation matches the event-scoped multi-event model.

## Epics

### 1. Backend Foundation

Owner: Backend/API

Scope:

- Node.js + Express API structure.
- Firebase Admin SDK initialization.
- Firebase ID token verification.
- Event member and role authorization middleware.
- Shared error handling and request audit context.
- Event bootstrap routes for `GET /api/events?registration=true`, `POST /api/events`, and `POST /api/events/:eventId/registration`.
- Firestore event documents at `/events/{eventId}` where `eventId` is a slug and `registration=true` marks credentialing events.

Dependencies:

- Firestore event/member model.

Acceptance criteria:

- protected routes reject missing or invalid Firebase ID tokens;
- protected event routes reject users without event membership;
- route handlers can access `uid`, event member roles, and request correlation ID.
- `super_admin` and global `event_manager` users can create a new credentialing event and enable credentialing on an existing event document.
- normal event listing returns only events with `registration=true`.

### 2. Firestore Data Model And Rules

Owner: Data/Security

Scope:

- Named Firestore database `attendee-registry` for all credentialing operational data.
- Collections, subcollections, indexes, and aggregate documents.
- Security Rules for client-readable operational data.
- Secret isolation for Swoogo and SendGrid.
- Transaction/idempotency rules for credentials, print jobs, and passages.

Dependencies:

- Backend Foundation.

Acceptance criteria:

- sensitive integration secrets are not readable by clients;
- participant, credential, print job, session, area, and message records have documented indexes;
- critical mutations are routed through backend APIs.

### 3. Swoogo Integration

Owner: Backend/API

Scope:

- OAuth client credentials token handling.
- Registrant import and lookup.
- Manual registrant creation.
- Session import/create/update.
- Registrant session assignment.
- Session scan/check-in.

Dependencies:

- Backend Foundation.
- Firestore Data Model.

Acceptance criteria:

- token cache refreshes before or after expiration;
- import is paginated and idempotent;
- manual registration creates Swoogo registrant before local participant;
- session check-in calls Swoogo exactly once per accepted scan.

### 4. SendGrid Integration

Owner: Backend/API

Scope:

- Event-specific SendGrid integrations.
- Event-specific template mappings by purpose.
- Confirmation message jobs.
- Mail Send API.
- Event Webhook reconciliation.

Dependencies:

- Firestore Data Model.
- Backend Foundation.

Acceptance criteria:

- template IDs are loaded from event configuration, not hardcoded;
- API keys are secret references or encrypted fields;
- message jobs store config snapshots;
- SendGrid delivery/bounce/drop events update job status.

### 5. Participant Lifecycle

Owner: Backend/API + Frontend Admin

Scope:

- Swoogo import.
- Manual admin registration.
- Confirmation email dispatch.
- Participant search and reconciliation.

Dependencies:

- Swoogo Integration.
- SendGrid Integration.
- Admin Frontend Foundation.

Acceptance criteria:

- imported and manually registered participants share the same local participant shape;
- duplicate email handling is explicit;
- participant audit logs show source and actor.

### 6. Credentialing And Badge Control

Owner: Backend/API + Frontend + Printing

Scope:

- Pre-check-in.
- Queue assignment.
- Firestore auto ID credential QR payload.
- Print job creation.
- Badge issue, delivery, reissue, and void.
- Cancelled badge red-alert scan response.

Dependencies:

- Firestore transactions.
- Print worker contract.
- Frontend scanner components.

Acceptance criteria:

- `credentialQrPayload` uses Firestore credential document ID as `BADGEID`;
- reissue creates a new credential and voids the previous active credential in one transaction;
- voided credentials block scans with a red alert response;
- participant active credential fields always point to the current active badge.

### 7. Local Printing

Owner: Printing/Deployment

Scope:

- Local worker.
- Print terminal registration and heartbeat.
- Badge rendering.
- CUPS/macOS spooler integration.
- Print retry/failure handling.

Dependencies:

- Credentialing And Badge Control.
- Badge Layout Format.

Acceptance criteria:

- worker can claim only allowed queued jobs;
- printed jobs update credential and participant state;
- failed jobs preserve diagnostic errors;
- deployment runbook covers Raspberry Pi and macOS.

### 8. Admin Frontend

Owner: Frontend

Scope:

- React + Vite + TypeScript app foundation.
- Auth and role-based navigation.
- Event configuration.
- Swoogo and SendGrid settings.
- Manual registration.
- Queues, access areas, gates, sessions, credentials, users, roles.
- Statistics dashboard.

Dependencies:

- Backend Foundation routes.
- Firestore read contracts.

Acceptance criteria:

- users only see actions allowed by role;
- event-specific SendGrid templates can be managed;
- access area permissions and participant overrides can be configured;
- dashboard displays live operational stats.

### 9. Pre-check-in Kiosk

Owner: Frontend + Backend/API

Scope:

- Camera scanner using `jsQR`.
- Email lookup.
- Participant validation.
- Queue result display.
- Print job/credential creation through backend.

Dependencies:

- Credentialing APIs.
- Auth roles.

Acceptance criteria:

- duplicate pre-check-ins do not create duplicate jobs;
- successful scans show participant and assigned queue;
- error states are clear and fast for operators.

### 10. Mobile Operations

Owner: Frontend + Backend/API

Scope:

- Mobile PWA scanner shell.
- Session check-in mode.
- Gate/access-area mode.
- Cancelled badge alert.
- Current area movement.

Dependencies:

- Session APIs.
- Access area APIs.
- Credential validation API.

Acceptance criteria:

- session mode sends Swoogo session scan and optionally moves participant to linked area;
- gate mode records local area passage without calling Swoogo;
- cancelled badges produce a blocking red alert;
- participant current area is updated after allowed area scans.

### 11. Badge Layout Editor

Owner: Frontend + Printing/Deployment

Scope:

- Visual layout editor.
- Field visibility and positioning.
- QR Code field from `credentialQrPayload`.
- Layout versioning.
- Print worker rendering contract.

Dependencies:

- Credentialing model.
- Local printing rendering pipeline.

Acceptance criteria:

- layout preview matches print worker output contract;
- hidden fields are not rendered;
- reprints preserve the intended layout version.

### 12. Analytics, Audit, And Reconciliation

Owner: Data/Security + Backend/API

Scope:

- Audit log events.
- Queue time metrics.
- Participant/session/area statistics.
- Swoogo reconciliation.
- SendGrid reconciliation.
- Monitoring and alerts.

Dependencies:

- Core operational flows.

Acceptance criteria:

- dashboard counters have documented sources;
- sensitive actions emit audit logs;
- stuck print jobs and repeated cancelled badge scans can be detected.

## Suggested Build Order

1. Backend Foundation.
2. Firestore Data Model And Rules.
3. Swoogo Integration.
4. SendGrid Integration.
5. Participant Lifecycle.
6. Credentialing And Badge Control.
7. Pre-check-in Kiosk.
8. Local Printing.
9. Admin Frontend.
10. Mobile Operations.
11. Badge Layout Editor.
12. Analytics, Audit, And Reconciliation.

## Sub-backlogs

The following sub-agent-owned files provide deeper task breakdowns:

- `docs/backlog/backend-integrations.md`
- `docs/backlog/frontend-apps.md`
- `docs/backlog/data-security-analytics.md`
- `docs/backlog/printing-deployment.md`
