# Printing Runbook

## Scope

This runbook covers the first local print-worker scaffold for Swoogo event credentialing. The current worker is safe by default:

- dry-run is the default mode;
- no Firestore connection is made by this slice;
- no CUPS or macOS print job is submitted unless spooler execution is explicitly enabled in a future validated flow;
- Brother QL-800 is the first printer target;
- DYMO remains a later validation track.

The worker entrypoint is:

```bash
node workers/print-worker/index.js --mode=dry-run
```

## Hardware Assumptions

Recommended first printer: Brother QL-800.

Baseline assumptions for the first rehearsal:

- USB-connected Brother QL-800 per print terminal.
- Label stock supports a 62 mm wide badge, with the first runtime target `62x100mm`.
- Printer queue is named consistently on every terminal, for example `Brother_QL_800_Badges`.
- The OS spooler accepts `lp` commands.
- The worker runs as a local user that can read its config and submit print jobs.
- Physical label size, cutter behavior, margins, and QR scan reliability are validated before event day.

DYMO should only be used after a separate driver, media, Raspberry Pi, and macOS rehearsal proves the same dry-run, calibration, print, scan, and recovery flow.

## Configuration

The worker loads configuration from environment variables and an optional JSON config file. Environment variables override file values.

Required outside dry-run:

```text
API_BASE_URL=
PRINTER_NAME=
```

The local worker does not receive a Swoogo event ID or local event document ID through
environment variables. It stores a local terminal identity the first time it is run, sends
that terminal ID to the backend, and the backend resolves
`events/{eventId}/printTerminals/{terminalId}` from Firestore. The Swoogo event ID remains
in the event configuration document.

First execution on a physical terminal:

```bash
node workers/print-worker/index.js \
  --mode=once \
  --terminal-id=printer-mac-01 \
  --terminal-name="Printer Mac 01"
```

By default, the identity is saved at
`~/.config/swoogo-selfcheckin/print-terminal.json`. Use `--terminal-config=PATH` when a
different local path is needed. Later executions can omit `--terminal-id` and
`--terminal-name`.

Common optional settings:

```text
WORKER_MODE=dry-run
PRINT_OUTPUT_FORMAT=pdf
PRINT_MEDIA=Custom.62x100mm
PRINTER_TYPE=brother-ql-800
QUEUE_IDS=default,vip
BADGE_RENDER_TMP_DIR=/tmp/swoogo-print-worker
CLAIM_POLL_INTERVAL_MS=1000
HEARTBEAT_INTERVAL_MS=30000
PRINTING_TIMEOUT_SECONDS=180
MAX_PRINT_ATTEMPTS=3
LOG_LEVEL=info
PRINT_WORKER_ALLOW_SPOOL=0
```

Optional config file:

```json
{
  "apiBaseUrl": "https://example.invalid",
  "printerName": "Brother_QL_800_Badges",
  "printerType": "brother-ql-800",
  "queueIds": ["default"],
  "printMedia": "Custom.62x100mm",
  "mode": "dry-run"
}
```

Run with a config file:

```bash
node workers/print-worker/index.js --config=./local-print-worker.json --mode=dry-run
```

## Dry-Run Workflow

Dry-run proves local config, payload validation, render-data generation, and spooler command planning without Firestore or printing.

1. Run the default fixture:

```bash
node workers/print-worker/index.js --mode=dry-run
```

2. Inspect the structured log output. It should include:

- `print_worker.job_claimed`;
- `print_worker.job_completed`;
- a generated `renderDataPath`;
- a planned `lp` command;
- `spoolerDryRun: true`.

3. Inspect the generated render-data JSON in `BADGE_RENDER_TMP_DIR` or `/tmp/swoogo-print-worker`.

4. Use a custom fixture when testing edge cases:

```bash
node workers/print-worker/index.js --mode=dry-run --fixture=./workers/print-worker/fixtures/sample-print-job.json
```

Current dry-run output is render data, not a real PDF or PNG. The renderer package will later replace the planned output path with an exact-size badge file.

## macOS Printer Setup

Use this checklist for a fresh macOS print terminal.

1. Install the Brother QL-800 driver or confirm the OS-provided driver is approved for the event image.
2. Connect the printer by USB.
3. Add the printer in System Settings.
4. Rename the queue to a stable name, for example `Brother_QL_800_Badges`.
5. Confirm the queue exists:

```bash
lpstat -p Brother_QL_800_Badges -l
```

6. Confirm the queue accepts jobs:

```bash
lpstat -a Brother_QL_800_Badges
```

7. Capture default options:

```bash
lpoptions -p Brother_QL_800_Badges -l
```

8. After the PDF/PNG renderer exists, print a calibration badge:

```bash
lp -d Brother_QL_800_Badges -o media=Custom.62x100mm /path/to/calibration-badge.pdf
```

Record the macOS version, driver version, queue name, media setting, label stock, and worker version in the event deployment checklist.

## Raspberry Pi And CUPS Setup

Use this checklist for Raspberry Pi OS or another Debian-like image. Validate package names and drivers on the final image before event day.

1. Install CUPS and the approved Brother driver or raster driver for QL-800.
2. Add the worker user to the group allowed to submit print jobs.
3. Connect the printer by USB.
4. Confirm USB detection:

```bash
lsusb
```

5. Add the printer queue through the CUPS UI or `lpadmin`, using a stable queue name:

```bash
sudo lpadmin -p Brother_QL_800_Badges -E -v usb://BROTHER/QL-800 -m everywhere
```

The URI and model are placeholders. Use the URI and driver confirmed by `lpinfo` and the tested event image.

6. Confirm queue health:

```bash
lpstat -p Brother_QL_800_Badges -l
lpstat -a Brother_QL_800_Badges
lpoptions -p Brother_QL_800_Badges -l
```

7. After the PDF/PNG renderer exists, print a calibration badge:

```bash
lp -d Brother_QL_800_Badges -o media=Custom.62x100mm /path/to/calibration-badge.pdf
```

Record the Pi model, OS image, CUPS version, driver source, queue name, media setting, label stock, and worker version.

## Spooler Strategy

The first spooler target is the CUPS/macOS `lp` command:

```bash
lp -d "$PRINTER_NAME" -o media=Custom.62x100mm badge.pdf
```

The worker builds this as a command plus argument array, not as shell interpolation. This keeps printer names with spaces safe and makes logs easier to audit.

Outside dry-run, this scaffold fails closed unless spooler execution is explicitly enabled. Backend job claiming is still stubbed in this slice, so physical printing should only be attempted after the backend lifecycle and renderer are wired and a calibration file exists.

The scaffold also emits diagnostic command plans for:

- queue details: `lpstat -p "$PRINTER_NAME" -l`;
- accepting jobs: `lpstat -a "$PRINTER_NAME"`;
- default options: `lpoptions -p "$PRINTER_NAME" -l`.

## Operational Recovery

Printer offline:

- Detection: `lpstat -p "$PRINTER_NAME" -l` reports disabled, offline, or missing.
- Action: check power, USB, labels, lid, and queue name. Resume the queue after the physical issue is fixed.
- Escalation: swap to a spare printer and update `PRINTER_NAME` only after the spare queue is validated.

CUPS queue paused or rejecting:

- Detection: `lpstat -a "$PRINTER_NAME"` does not show accepting jobs, or `lp` exits non-zero.
- Action: resume or re-enable the queue with the approved event command set.
- Recovery: failed jobs should remain visible to operators for retry once backend lifecycle APIs exist.

Stuck job in `printing`:

- Detection: job has stayed in `printing` longer than `PRINTING_TIMEOUT_SECONDS`.
- Action: future backend recovery should move it to a retryable failed state with code `timeout`.
- Operator note: do not manually edit Firestore during event operations.

Bad layout or render failure:

- Detection: dry-run validation rejects unknown sources, invalid dimensions, negative positions, or QR boxes below 18 mm.
- Action: switch to the last published layout version that passed calibration.
- Recovery: re-run dry-run, print calibration, scan QR, then re-enable the terminal.

Repeated `spool_rejected`:

- Detection: several failures from the same terminal or printer queue.
- Action: stop the worker, run diagnostics, clear or recreate the queue, and print a calibration badge.
- Escalation: move the terminal to a spare printer or spare machine.

Out of labels or cutter issue:

- Detection: printer reports media error, badges are partially cut, or physical output does not match `62x100mm`.
- Action: reload approved stock and print calibration before returning to production.

## Pre-Event Validation

Before doors open, each physical terminal must record:

- event ID;
- terminal ID;
- queue IDs;
- printer name;
- printer model and serial if available;
- OS version;
- driver or CUPS version;
- media setting;
- label stock;
- worker version;
- layout ID and layout version;
- dry-run result;
- calibration print result;
- QR scan result.

Pass criteria:

- dry-run succeeds;
- CUPS/macOS diagnostics show the queue exists and accepts jobs;
- calibration badge measures within event tolerance;
- QR payload decodes exactly as `BADGEID;epochSeconds;SWOOGOID`;
- operator can recover from a paused queue using the runbook.
