# Printing And Deployment Backlog

## Scope

This backlog turns the printing portions of `docs/automatic-event-credentialing.md` into implementable work for:

- local print workers that claim Firestore print jobs and print through the OS spooler;
- CUPS/macOS printer configuration for Brother QL-800 first, with DYMO treated as a separately validated option;
- badge PDF/PNG rendering, QR encoding, and layout runtime format;
- print terminal provisioning, heartbeat, install scripts, and event runbooks;
- reprint, reissue, failure recovery, and deployment validation flows.

Non-goals:

- browser `window.print()` automation;
- session check-in, gate access, or SendGrid implementation except where they depend on printed credential QR payloads;
- full visual layout editor UX beyond the runtime format required by the renderer.

## Working Assumptions

- The printed credential QR payload is `BADGEID;epochSeconds;SWOOGOID`, where `BADGEID` is the Firestore auto-generated credential document ID.
- Pre-check-in creates or reserves the credential and print job in one backend transaction.
- The worker may have a small local dashboard, but the actual print action runs in a local process, not the browser.
- Brother QL-800 is the first printer to validate for Raspberry Pi and macOS deployments.
- Print terminals are event-scoped and queue-scoped.

## Suggested Order

1. Lock data contracts for `printJobs`, `credentials`, `badgeLayouts`, and `printTerminals`.
2. Implement backend print job lifecycle APIs and transactional state changes.
3. Build a deterministic badge renderer that outputs exact-size PDF/PNG files from layout JSON and payload snapshots.
4. Build the local worker with dry-run rendering, then OS spooler printing, then Firestore claim/complete/fail.
5. Validate Brother QL-800 setup on macOS, then Raspberry Pi/CUPS.
6. Add terminal provisioning, heartbeat, health reporting, and install/run scripts.
7. Add reprint/reissue operator flows and audit coverage.
8. Write deployment validation and incident runbooks, then run an end-to-end dress rehearsal with physical labels.

## Epic 1: Print Data Contracts And Backend Lifecycle

Goal: make print job, credential, terminal, and layout documents safe to operate under concurrent terminals.

Tasks:

- Define TypeScript/shared schema for `events/{eventId}/printJobs/{jobId}` with `status`, `queueId`, `terminalId`, `layoutId`, `credentialBadgeId`, `credentialId`, `attempts`, `priority`, timestamps, `payloadSnapshot`, and normalized `error`.
- Define credential schema with `badgeId`, `credentialId`, `qrPayload`, `participantId`, `swoogoRegistrantId`, status, queue, terminal, layout, issued/delivered/void fields, and reprint/reissue references.
- Define `printTerminals` schema with `name`, `status`, `queueIds`, `printerName`, `printerType`, `platform`, `capabilities`, `lastHeartbeatAt`, `lastSeenVersion`, and `lastError`.
- Define `badgeLayouts` runtime schema with physical dimensions in millimeters, `dpi`, field list, version, status, registration type override metadata, and immutable published snapshots.
- Add recommended indexes for `printJobs(status, queueId, priority, createdAt)` and credential lookups by participant, badge ID, credential ID, and status.
- Implement backend pre-check-in transaction that creates the Firestore credential document reference first, composes `BADGEID;epochSeconds;SWOOGOID`, stores it on the credential, and stores the same value in the print job payload snapshot.
- Implement `POST /api/events/:eventId/print-jobs/:jobId/claim`.
- Implement `POST /api/events/:eventId/print-jobs/:jobId/complete`.
- Implement `POST /api/events/:eventId/print-jobs/:jobId/fail`.
- Add stuck-job recovery policy for jobs in `printing` beyond a configured timeout.
- Write audit logs for job created, claimed, printed, failed, retried, reprinted, credential issued, credential voided, and credential reissued.

Dependencies:

- Firebase Auth role checks and event membership loading.
- Participant and queue schemas.
- Firestore indexes and security rules that route sensitive writes through the backend.

Acceptance Criteria:

- Two workers listening to the same queue cannot print the same queued job.
- Claim fails if the job is no longer `queued`, if the terminal is not allowed for the queue, or if the terminal is inactive.
- Completion moves `printJob.status` to `printed`, credential status to `issued`, and participant credentialing status to `printed` in one transaction.
- Failure records a normalized error, increments attempts, moves the credential to `failed` or back to a retryable state according to policy, and makes the participant visible for operator recovery.
- Audit logs can reconstruct who printed, when, from which terminal, with which layout version.

## Epic 2: Badge Rendering And Runtime Layout Format

Goal: render exact-size badges consistently on local workers and in admin previews.

Tasks:

- Create a renderer package/module that accepts a published layout JSON document plus a print job `payloadSnapshot`.
- Support output to PDF and PNG at exact physical dimensions, starting with `62x100mm` at `300dpi`.
- Implement QR generation from `payloadSnapshot.credentialQrPayload`.
- Support text fields for full name, first name, company, job title, and future optional fields.
- Implement text fitting rules: max lines, ellipsis or shrink-to-fit policy, alignment, font size, weight, visibility, and safe overflow handling.
- Resolve active layout by event default first, then registration type override.
- Snapshot `layoutId` and `layoutVersion` onto each print job so reprints are consistent.
- Add sample fixtures for common names, very long names, missing company, VIP/staff layout variants, and QR-only failure isolation.
- Add renderer validation that rejects unknown field sources, invalid millimeter dimensions, negative positions, unsupported font settings, and QR boxes too small to scan.
- Add a CLI dry run that writes PDF/PNG output without printing.

Dependencies:

- Published `badgeLayouts` runtime schema.
- Font assets or a deployment-approved system font list.
- QR encoding library selected for backend/worker use.

Acceptance Criteria:

- Given the same layout version and payload snapshot, the renderer produces stable output on macOS and Raspberry Pi.
- Output dimensions match configured millimeters within printer tolerance.
- QR payload decodes exactly as `BADGEID;epochSeconds;SWOOGOID`.
- Long text never overlaps the QR code or leaves the badge bounds.
- A failed render marks the print job as `print_failed` and does not spool a partial badge.

## Epic 3: Local Print Worker

Goal: run a local process that listens for jobs, renders badges, prints through the OS spooler, and reports health.

Tasks:

- Create worker entrypoint with modes: `dry-run`, `once`, and `watch`.
- Load configuration from environment variables and optional local config file.
- Authenticate as a terminal account or operator-approved terminal identity.
- Load `events/{eventId}/printTerminals/{terminalId}` and enforce allowed `queueIds`.
- Listen or poll for queued print jobs where `status = queued` and `queueId` is allowed by the terminal.
- Claim jobs through the backend API or a trusted server-mediated transaction.
- Render the badge to a local temp PDF/PNG path.
- Send output to the configured spooler command.
- Mark completion only after the spooler accepts the job.
- Mark failure with stage-specific error codes: `claim_failed`, `layout_missing`, `render_failed`, `printer_unavailable`, `spool_rejected`, `timeout`, `unknown`.
- Add bounded retries, backoff, and dead-letter behavior after max attempts.
- Write structured local logs with job ID, badge ID, terminal ID, queue ID, stage, duration, and spooler job ID when available.
- Expose a local health endpoint or command that reports worker version, terminal ID, printer name, spooler availability, last heartbeat, last job, and last error.

Dependencies:

- Backend claim/complete/fail APIs.
- Renderer dry-run output.
- Printer queue configured locally.

Acceptance Criteria:

- Worker can process one job end to end from `queued` to `printed`.
- Worker can run without a browser and without a print dialog.
- Killing the worker mid-job leaves enough state for timeout recovery.
- Printer offline or missing queue produces `print_failed` with a useful operator-facing error.
- Dry-run mode can be used in CI or staging without a physical printer.

## Epic 4: CUPS, macOS, And Printer Configuration

Goal: make physical printer setup repeatable and measurable before event day.

Tasks:

- Document Brother QL-800 supported label stock, expected badge size, cutter behavior, USB connection, and tested OS versions.
- Create macOS setup runbook for installing the printer, naming the print queue, setting default media, and printing a calibration badge.
- Create Raspberry Pi/CUPS setup runbook for package installation, USB detection, CUPS queue creation, media size, and permissions for the worker user.
- Define required spooler command templates, starting with `lp -d "$PRINTER_NAME" -o media=Custom.62x100mm badge.pdf`.
- Add printer diagnostics command that checks queue existence, accepts jobs, paused state, and recent CUPS errors.
- Add calibration output with border, QR code, and ruler marks to confirm physical dimensions and scan reliability.
- Validate DYMO only as a separate track after Brother QL-800 passes the first full rehearsal.
- Capture known-good printer settings in a deployment checklist.

Dependencies:

- Renderer can create calibration output.
- Physical Brother QL-800 and label stock are available.
- Target macOS and Raspberry Pi images are available.

Acceptance Criteria:

- A fresh macOS terminal can be configured from the runbook and print a scannable calibration badge.
- A fresh Raspberry Pi terminal can be configured from the runbook and print a scannable calibration badge.
- The worker refuses to start, or starts unhealthy, when `PRINTER_NAME` does not map to an available queue.
- Deployment notes include exact printer name, media setting, label stock, OS version, and worker version.

## Epic 5: Terminal Provisioning, Heartbeat, And Health

Goal: make local terminals easy to register, identify, monitor, and disable.

Tasks:

- Add admin UI/API for creating `printTerminals` with name, event, queue IDs, printer type, expected printer name, and status.
- Add terminal enrollment flow using a short-lived pairing code or operator-assisted login.
- Persist terminal identity locally after enrollment.
- Add heartbeat update every 30 seconds with worker version, platform, printer queue status, current job ID, last successful print, and last error.
- Mark terminals stale after 60 seconds without heartbeat.
- Add terminal status dashboard for active, stale, disabled, printer unavailable, and currently printing.
- Add backend enforcement that disabled terminals cannot claim jobs.
- Add terminal capability snapshot for supported output formats, DPI, printer model, and layout sizes.

Dependencies:

- Admin role model.
- Worker local configuration storage.
- Backend terminal document schema.

Acceptance Criteria:

- An admin can provision a terminal without manually editing Firestore.
- A disabled or stale terminal cannot claim a new job.
- Operators can tell which terminal printed a badge and whether its printer is currently healthy.
- Dashboard alerts fire when heartbeat is missing for more than 60 seconds.

## Epic 6: Reprint, Reissue, And Operator Recovery Flows

Goal: support normal event-day recovery without breaking credential traceability.

Tasks:

- Define retry failed print flow that reuses the same credential only when the physical badge was not successfully issued.
- Define reprint flow that requires a reason and creates an auditable history entry.
- Define reissue flow that voids the old active credential, creates a new Firestore credential with a new `BADGEID`, creates a new print job, and updates participant active credential fields.
- Add backend validation for `credential_reissuer` and `event_admin` roles on reissue.
- Add print/pickup UI actions for retry failed print, reprint, reissue, mark delivered, and view credential history.
- Add operator prompts for required reason values: `lost_badge`, `damaged_badge`, `name_correction`, `wrong_badge`, `admin_override`.
- Add safeguards preventing two active delivered credentials for one participant unless explicitly allowed by an audited admin override.
- Add cancelled badge scan behavior to prevent pickup or delivery using voided credentials.

Dependencies:

- Credential lifecycle transaction support.
- Audit logging.
- Print terminal/pickup interface.

Acceptance Criteria:

- Retrying a failed render/spool attempt does not create a new credential unless policy requires it.
- Reissue always creates a new `BADGEID` and QR payload.
- The previous active badge is voided in the same transaction that creates the replacement credential.
- If replacement printing fails, the old credential remains void unless an event admin performs an audited exception.
- Credential history clearly shows original issue, reprints, reissues, void reasons, operator, terminal, and timestamps.

## Epic 7: Install Scripts, Local Configuration, And Runtime Operations

Goal: reduce event-day setup to repeatable commands and explicit environment variables.

Tasks:

- Add install script for macOS terminal setup.
- Add install script for Raspberry Pi terminal setup.
- Add run script for worker `watch` mode.
- Add run script for renderer dry-run and calibration output.
- Add service setup for macOS `launchd` and Raspberry Pi `systemd`.
- Add local `.env.example` for worker configuration.
- Add log rotation and temp-file cleanup.
- Add version command that prints worker version, Node/runtime version, terminal ID, printer name, renderer version, and the backend-resolved event binding.

Local terminal identity:

```bash
node workers/print-worker/index.js --terminal-id=printer-mac-01 --terminal-name="Printer Mac 01"
```

The worker stores this locally and later sends the terminal ID to the backend, which resolves
the event binding from Firestore.

Required environment variables:

```text
API_BASE_URL=
FIREBASE_PROJECT_ID=
FIREBASE_AUTH_MODE=
TERMINAL_TOKEN_PATH=
PRINTER_NAME=
PRINT_OUTPUT_FORMAT=pdf
PRINT_MEDIA=Custom.62x100mm
WORKER_MODE=watch
CLAIM_POLL_INTERVAL_MS=1000
HEARTBEAT_INTERVAL_MS=30000
PRINTING_TIMEOUT_SECONDS=180
MAX_PRINT_ATTEMPTS=3
BADGE_RENDER_TMP_DIR=
LOG_LEVEL=info
```

Dependencies:

- Worker entrypoint exists.
- Printer setup runbooks are validated.
- Authentication approach is selected.

Acceptance Criteria:

- A new terminal can be installed, enrolled, started, stopped, and restarted from documented commands.
- Worker survives reboot when installed as a service.
- Missing required environment variables fail fast with clear errors.
- Logs are discoverable by operators and include enough information to diagnose common print failures.

## Epic 8: Deployment Validation And Runbooks

Goal: provide the operational checklist needed before and during an event.

Tasks:

- Create pre-event validation checklist covering credentials, event config, queues, terminals, layouts, printer stock, network, and physical spare hardware.
- Create deployment smoke test that imports or creates a test participant, pre-checks them, creates a credential, prints a badge, scans the credential QR, marks delivered, reissues, and verifies the old QR is blocked.
- Create printer calibration runbook with pass/fail criteria for physical size, QR scan, text position, and cutter behavior.
- Create failure runbooks for printer offline, out of labels, CUPS queue paused, repeated `spool_rejected`, job stuck in `printing`, terminal heartbeat missing, bad layout, and accidental reissue.
- Define event-day metrics to watch: queued jobs, jobs in `printing`, average pre-check-in-to-print time, print failures by terminal, heartbeat freshness, credentials issued, credentials voided, and repeated reprints.
- Define post-event export/audit steps for printed, delivered, voided, failed, and reissued credentials.

Dependencies:

- Worker and backend lifecycle are implemented.
- Terminal heartbeat dashboard exists.
- Badge scan validation exists for credential QR payloads.

Acceptance Criteria:

- A non-developer operator can follow the runbook to validate a terminal before doors open.
- Dress rehearsal proves at least one complete print and one reissue on every physical printer.
- Each documented failure mode has a clear detection signal, immediate operator action, and escalation path.
- Deployment validation records event ID, terminal ID, printer serial/name, worker version, layout version, label stock, and timestamp.

## Cross-Epic Definition Of Done

- All sensitive print state mutations are backend-mediated and event-role checked.
- No production path depends on browser print dialogs.
- Every printed badge is traceable to one credential document, one print job, one layout version, and one terminal.
- Every QR code encodes the credential payload, not only the Swoogo registrant ID.
- A failed print is visible to operators and can be recovered without manual Firestore edits.
- Physical output is validated on real hardware before event use.
