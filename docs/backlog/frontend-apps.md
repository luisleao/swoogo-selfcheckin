# Frontend Applications Backlog

## Scope

Build the frontend surface for the event credentialing system described in `docs/automatic-event-credentialing.md`.

Suggested stack:

- React, Vite, and TypeScript.
- Firebase Auth on every interface.
- API-backed sensitive mutations; clients do not write integration secrets, credentials, counters, roles, or scan decisions directly.
- PWA support for mobile scanners and field terminals.
- `jsQR` camera scanning for QR workflows.
- One shared frontend codebase is preferred, with role-scoped routes for Admin, pre-check-in, print/pickup, mobile sessions, and mobile gate access.

## Assumptions

- Backend API routes and Firestore paths follow the architecture document.
- Role checks are enforced by the backend and reflected in frontend route guards.
- The print terminal browser UI coordinates with a local print worker; browser `window.print()` is not the production print path.
- Offline support is optional for mobile session scans and should not be enabled for gate access unless the event security model explicitly allows it.

## Suggested Order

1. App foundation, design primitives, typed API client, and PWA shell.
2. Firebase Auth, event selection, route guards, and role-based navigation.
3. Admin event setup, Swoogo settings, SendGrid settings, users, roles, queues, and terminal configuration.
4. Registration type, participant import, participant list, manual registration, and confirmation email screens.
5. Shared scanner/result components, including the blocking cancelled badge red alert UX.
6. Pre-check-in terminal.
7. Print terminal and pickup workflow with fixed badge layout rendering.
8. Credential controls, reprint, void, and reissue UI.
9. Access areas, gates, participant overrides, and sessions administration.
10. Mobile session check-in and mobile gate access scanner flows.
11. Event statistics dashboard.
12. Visual badge layout editor and versioned layout publishing.

## Epics

### FE-01: React/Vite Application Foundation

Tasks:

- Scaffold the React + Vite + TypeScript app structure for shared app shell and route-based experiences.
- Add environment configuration for API base URL, Firebase client config, app mode defaults, and PWA flags.
- Add typed API client helpers for authenticated requests with Firebase ID tokens.
- Add shared loading, empty, error, confirmation modal, toast, table, form, status badge, and scanner-result primitives.
- Add responsive layout rules for desktop admin, kiosk terminals, and mobile scanner screens.
- Add Vitest/unit test setup and Playwright smoke-test setup.
- Add PWA manifest, installability metadata, service worker registration, update prompt, and online/offline banner.

Dependencies:

- Firebase web config.
- API authentication contract.
- Initial route map and role list.

Acceptance criteria:

- App builds with TypeScript strict checks and linting.
- Authenticated API helper attaches a fresh Firebase ID token.
- Core layout works at desktop, tablet, and mobile widths.
- PWA can be installed in a supported browser and shows clear online/offline state.
- Smoke tests can load the unauthenticated login route and a mocked authenticated route.

### FE-02: Routing, Authentication, And Role-Based Navigation

Tasks:

- Build Firebase sign-in, sign-out, auth persistence, token refresh, and expired-session handling.
- Add event selector with active event context.
- Add protected route wrappers for event membership and role requirements.
- Add role-scoped navigation for Admin, pre-check-in, print/pickup, sessions, gates, dashboard, and layout editor.
- Add no-access, inactive-member, inactive-event, and missing-terminal screens.
- Persist selected event, terminal, session, and gate where appropriate.

Dependencies:

- `users/{uid}` and `events/{eventId}/members/{uid}` read contracts.
- Backend endpoint or Firestore read policy for current user event memberships.

Acceptance criteria:

- Users only see navigation items allowed by their event roles.
- Direct URL access to a forbidden route is blocked before sensitive data loads.
- Switching events refreshes role state and clears incompatible terminal/session/gate selections.
- Terminal operators can resume the last selected terminal without bypassing role checks.

### FE-03: Admin Event And Integration Configuration

Tasks:

- Build credentialing event list from `GET /api/events?registration=true`.
- Build first-event bootstrap for `super_admin` and global `event_manager` users when no event membership exists yet.
- Build create event flow that saves `/events/{eventId}` where `eventId` is a slug and `registration=true`.
- Build existing-event activation flow that sets `registration=true` on an existing `/events/{eventId}` document.
- Build edit event, status, timezone, Swoogo event ID, Swoogo base URL, and defaults screens.
- Build Swoogo configuration screen with event ID, base URL, secret reference metadata, connection test, and last-test result.
- Build SendGrid configuration screens for integrations, sender identity, reply-to, template purpose mapping, test connection, and test email.
- Redact secret values and show only safe metadata or secret references.
- Build registration types, queues, and terminal configuration screens.
- Build users and event roles management with allowed queues, sessions, areas, and gates.

Dependencies:

- Event CRUD API.
- Swoogo and SendGrid test endpoints.
- Role mutation endpoint.
- Queue, terminal, registration type, session, area, and gate read models.

Acceptance criteria:

- Event admins can fully configure an event without exposing raw Swoogo or SendGrid secrets.
- Super admins and global event managers can create the first credentialing event or enable credentialing on an existing event document.
- Only events with `registration=true` appear in normal event selectors.
- Connection tests show success/failure, timestamp, and actionable error text.
- Role changes are audited by backend and reflected in the UI after refresh.
- Queue and terminal screens prevent deleting or disabling active operational dependencies without confirmation.

### FE-04: Participants, Import, Manual Registration, And Messaging

Tasks:

- Build participant import screen with start import, progress, imported/updated/error counts, retry, and sync-job history.
- Build participant list with search by name, email, Swoogo ID, badge ID, credential status, registration type, and source.
- Build participant detail view with Swoogo fields, credentialing timeline, sessions, area presence, messages, and audit summary.
- Build manual registration form with required fields, package/session selection, Swoogo email toggle, credential email toggle, and capacity override controls.
- Add duplicate email reconciliation flow for existing local or Swoogo registrants.
- Add confirmation email send/resend controls with message-job status.

Dependencies:

- Registrant import endpoint and `syncJobs`.
- Participant search/list/detail endpoints or allowed reads.
- Manual registration endpoint.
- SendGrid message job endpoints.
- Session and registration type data.

Acceptance criteria:

- Operators can import registrants and inspect failures without leaving the Admin app.
- Manual registration creates or links a Swoogo registrant before showing a local success state.
- Duplicate handling blocks accidental duplicate participants and offers a clear link/reconcile path.
- Confirmation resend is idempotent and disabled when policy says the message should not be resent.

### FE-05: Shared Scanner And Cancelled Badge Result UX

Tasks:

- Build reusable camera permission, camera selection, scan loop, torch toggle when available, and QR parse components around `jsQR`.
- Build common scan result states: ready, scanning, allowed, denied, duplicate, invalid badge, invalid participant, sync failure, offline pending, and blocked.
- Build the required cancelled badge alert component with prominent red background and title `Badge cancelled`.
- Show participant name, scanned badge ID, cancellation reason, cancellation time, and replacement badge ID when returned by the backend.
- Ensure blocked/cancelled states prevent session check-in, gate access, badge pickup, delivery, and pre-check-in continuation.
- Emit UI telemetry or API audit call when backend requires `credential.cancelled_scan_detected`.

Dependencies:

- Scan validation response schema from pre-check-in, session, gate, and pickup APIs.
- Device/browser camera permission behavior.

Acceptance criteria:

- Every scanner interface uses the same cancelled badge component and cannot accidentally accept a void credential.
- Red alert state is visible on mobile and terminal screens from at least 2 meters away.
- Operators have a safe next action to search for the participant or active replacement badge when their role allows it.
- Camera failures fall back to manual entry only where the workflow permits manual entry.

### FE-06: Pre-Check-In Terminal

Tasks:

- Build kiosk login and event/terminal selector.
- Build QR scanning for confirmation QR payloads and manual email lookup.
- Add state machine for ready, scanning, lookup pending, found, already checked in, sent to queue, error, and cancelled/blocked.
- Show participant name, assigned queue, queue instruction, and reset-to-ready countdown after success.
- Add terminal heartbeat/status indicator.
- Add kiosk-friendly idle mode, large touch targets, and optional language-neutral iconography.

Dependencies:

- Pre-check-in endpoint.
- Terminal config and allowed event/queue data.
- Shared scanner/result components.

Acceptance criteria:

- A valid confirmation QR or email triggers one pre-check-in transaction and never creates duplicate print jobs on repeated scans.
- Already processed participants return their current queue/status instead of creating new work.
- The terminal recovers cleanly after scan errors, API errors, camera permission denial, and idle timeout.
- Cancelled or invalid credential responses are hard-blocked if the endpoint returns them.

### FE-07: Print Terminal And Pickup UI

Tasks:

- Build print terminal selector and printer/worker heartbeat panel.
- Build queue job list for queued, claimed, printing, printed, failed, and ready-for-pickup states.
- Add claim, mark printed, mark failed, retry failed print, and reprint actions where role policy allows them.
- Render fixed badge previews from the active layout payload for operator verification.
- Build pickup workflow for document verification, badge delivery, optional swag delivery, and delivery notes.
- Add participant lookup by email, name, Swoogo ID, badge ID, and credential QR scan.
- Show credential history for the selected participant.

Dependencies:

- Print terminal config.
- Print job claim/complete/fail endpoints.
- Queue entry delivery endpoint.
- Fixed badge layout renderer.
- Local worker heartbeat/status contract.

Acceptance criteria:

- A terminal only sees jobs for its allowed queues.
- Claiming a job updates UI optimistically only after backend transaction success.
- Print failures are visible, retryable by authorized users, and do not mark credentials delivered.
- Pickup cannot mark a void credential as delivered; cancelled badge scans show the red blocking alert.

### FE-08: Credential Controls, Reissue, Void, And History

Tasks:

- Build credential search and detail views for active, reserved, issued, delivered, failed, and void credentials.
- Add reprint action for failed or policy-approved reprints.
- Add void action with required reason, confirmation, and audit summary.
- Add reissue action gated by `credential_reissuer` or `event_admin`, with required reason and old/new badge summary.
- Show active badge, replacement badge, previous badge, print job, queue, terminal, issued/delivered timestamps, and operator attribution.
- Add participant credential timeline and warnings for multiple active credentials.

Dependencies:

- Credential read/search endpoints.
- Reprint, void, and reissue endpoints.
- Role and audit metadata.

Acceptance criteria:

- Reissue UI makes it clear that the old badge is cancelled and a new credential/print job is created.
- Reissue cannot be submitted without a reason.
- Users without the correct role can view allowed data but cannot invoke reissue/void actions.
- Credential history remains understandable after repeated reprints and replacements.

### FE-09: Access Areas, Gates, And Sessions Administration

Tasks:

- Build access area list and editor with status, allowed/denied registration types, allowed badge statuses, default decision, and override mode.
- Build participant-specific allow/deny override UI with reason, validity dates, and audit visibility.
- Build gate list and editor with target area, mode, operator role, repeated-entry policy, and cancelled-credential policy.
- Build sessions import screen with Swoogo sync status.
- Build session list/editor for local/Swoogo sessions, capacity, date/time, location metadata, operators, and status.
- Add session-to-access-area linking and `enforceAreaPermissionForSessions` controls.

Dependencies:

- Access area, override, gate, and session CRUD endpoints.
- Registration type and participant lookup data.
- Swoogo session import/create/update endpoints.

Acceptance criteria:

- Area and gate configuration can express allow by registration type, explicit participant allow, explicit participant deny, and default deny.
- Session screens clearly identify linked access areas and whether area permissions are enforced.
- Admins can import sessions from Swoogo and see what changed, failed, or needs reconciliation.
- Gate operators only receive gates and areas assigned to them.

### FE-10: Mobile Session Check-In PWA

Tasks:

- Build mobile login, event selector, session selector, and session details header.
- Show linked area indicator when a session moves participants into an access area.
- Scan confirmation QR or printed credential QR.
- Show immediate success, duplicate, denied, invalid participant, invalid credential, cancelled badge, Swoogo sync failure, and offline pending results.
- Keep recent scan history for the active session.
- Add optional local pending queue only if offline mode is enabled for the event.

Dependencies:

- Session check-in endpoint.
- Shared scanner/result components.
- Optional offline sync policy and conflict rules.

Acceptance criteria:

- Successful session check-ins call the backend path that records Swoogo session attendance.
- Printed credential scans validate the credential before using the Swoogo registrant ID.
- A session linked to an area shows the area movement result returned by the backend.
- Cancelled badges are blocked with the shared red alert and never create Swoogo scans.

### FE-11: Mobile Gate Access PWA

Tasks:

- Build mobile login, event selector, gate selector, and target area header.
- Scan printed credential QR payloads in `BADGEID;epochSeconds;SWOOGOID` format.
- Show allowed, denied, invalid badge, and cancelled badge states with large color-coded feedback.
- Show local passage history for the selected gate.
- Show participant current area and previous area after allowed movement.
- Add clear copy and UI state confirming gate access does not create Swoogo session scans.

Dependencies:

- Gate scan endpoint.
- Gate and area assignment data.
- Shared scanner/result components.

Acceptance criteria:

- Gate scans never call session check-in endpoints from the client.
- Allowed scans show green feedback and updated current area.
- Denied scans show reason and are stored for audit by the backend.
- Cancelled badges show the required red blocking alert with old and replacement badge details when available.

### FE-12: Event Statistics Dashboard

Tasks:

- Build dashboard shell with event, time window, queue, registration type, session, and area filters.
- Add participant totals, manual registrations, imported count, pre-check-in count, badges issued, delivered, voided, and without credential.
- Add queue timing charts for pre-checked to printed, printed to delivered, and pre-checked to delivered.
- Add print terminal health and failure panels.
- Add SendGrid message status panels.
- Add session check-in counts, capacity utilization, and check-ins per minute.
- Add access area current occupancy, passages, denied scans, and cancelled badge scan attempts.
- Add alert panels for printer heartbeat, stuck jobs, high queue time, Swoogo/SendGrid error rate, repeated reprints, and cancelled badge scan bursts.

Dependencies:

- Dashboard stats endpoint or aggregated stats documents.
- Time bucket definitions.
- Terminal heartbeat and message job data.

Acceptance criteria:

- Dashboard loads from aggregated stats for high-volume events.
- Current area occupancy is based on participant `presence.currentAreaId`, not a sum of historical passages.
- Dashboard distinguishes issued badges, delivered badges, and cancelled badges.
- Operators can identify queue bottlenecks, printer issues, and access anomalies within one screen.

### FE-13: Badge Layout Editor

Tasks:

- Build visual editor using canvas or SVG with physical dimensions in millimeters and DPI-aware preview.
- Support credential QR Code, full name, first name, company, job title, and hideable fields.
- Add drag, resize, grid, snapping, alignment, font size, font weight, width, height, position, max lines, and visibility controls.
- Add sample-data preview and registration-type preview.
- Add event default layout and registration-type override assignment.
- Add version history, draft/publish flow, and published layout lock for consistent reprints.
- Add print-preview export used by the print terminal and local worker.

Dependencies:

- Badge layout CRUD/versioning endpoints.
- QR rendering utility.
- Print renderer contract shared with local worker.

Acceptance criteria:

- A non-technical event admin can publish a valid layout without editing JSON.
- Published layouts cannot be mutated in place; changes create a new version.
- Layout preview matches the fixed-size renderer used by print terminals.
- Registration-type override resolution is visible before publishing.

### FE-14: Frontend QA, Accessibility, And Release Hardening

Tasks:

- Add Playwright coverage for login, role guards, admin configuration, pre-check-in, print/pickup, mobile session scan, mobile gate scan, and cancelled badge alert.
- Add scanner tests with mocked camera frames and representative QR payloads.
- Add responsive visual checks for desktop admin, kiosk, print terminal, and mobile scanner breakpoints.
- Add accessibility pass for keyboard navigation, focus management, ARIA status announcements, and color contrast.
- Add production error reporting hooks and user-safe error messages.
- Add deployment checklist for environment variables, Firebase config, service worker cache busting, and terminal device setup.

Dependencies:

- Mock API fixtures or test backend.
- Representative QR payload fixtures.
- Deployment target.

Acceptance criteria:

- Critical flows have automated smoke coverage before field testing.
- Cancelled badge alert passes visual checks on every scanner surface.
- Camera-denied, offline, expired session, forbidden role, and API failure states are covered.
- Release checklist can be executed by an operator before an event.
