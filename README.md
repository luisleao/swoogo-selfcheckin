# Swoogo Self Check-in

Credentialing and access-control platform for Swoogo events.

This repository now contains the Express API, Firebase/Firestore integration,
React admin and operations UI, Firestore rules/indexes, system documentation,
and a local print worker for badge printers.

## What Is Implemented

- Multi-event credentialing records stored in the named Firestore database
  `attendee-registry`.
- Firebase Auth email/password login on the web app.
- Firestore-backed users, global roles, event members, and event-scoped roles.
- Admin event creation and editing at `/admin/event` and `/:eventSlug/admin`.
- Event-scoped Swoogo integration settings, registration type import, and
  credential validation helpers.
- Event-scoped SendGrid settings, API test, template listing, and cached
  template mapping stored in Firestore.
- Queue and terminal administration, including deletion safeguards.
- Area and session administration for access-control and session scanning.
- Operational routes for dashboard, pre-check-in, print/pickup, attendee list,
  scanner, and layout editor.
- Manual attendee list actions, including credential reissue print requests.
- Print worker onboarding for Brother QL-800 or DYMO 650 style deployments.
- Firestore rule and index manifests for the attendee registry data model.
- Documentation and implementation backlog under `docs/`.

## Project Layout

```text
src/                  Express API and Firebase Admin integration
src/api/              Auth, event routes, Firestore store, middleware
web/                  React + Vite frontend
workers/print-worker/ Local badge print worker
docs/                 System docs, backlog, runbooks, data/security models
firestore.rules       Firestore security rules
firestore.indexes.json Firestore index manifest
```

## Requirements

- Node.js 18+
- Firebase project with Firebase Auth enabled
- Firestore database named `attendee-registry`
- Firebase Admin credentials for the backend and print worker
- Swoogo API credentials configured per event in Firestore through the admin UI
- SendGrid API key configured per event in Firestore through the admin UI
- For printing: macOS/Raspberry Pi host with a configured printer queue

## Install

Install backend and worker dependencies:

```bash
npm install
```

Install frontend dependencies:

```bash
npm --prefix web install
```

## Backend Configuration

Create a root `.env` file. Do not commit it.

Required for normal backend use:

| Variable | Purpose |
| --- | --- |
| `PORT` | Express port. Defaults to `3000`. |
| `FIREBASE_PROJECT_ID` | Firebase project used by Firebase Admin. |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account client email. |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key. Use escaped `\n` newlines when stored in `.env`. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Alternative to service account fields when using Application Default Credentials. |
| `CORS_ORIGINS` | Optional comma-separated frontend origins. Defaults to local Vite origins. |
| `BOOTSTRAP_EVENT_MANAGER_UIDS` | Optional comma-separated Firebase Auth UIDs allowed to create/manage events before memberships exist. |
| `BOOTSTRAP_EVENT_MANAGER_EMAILS` | Optional comma-separated emails with the same bootstrap event-manager behavior. |

Swoogo and SendGrid secrets are intentionally not root environment variables.
They are configured per event from the admin UI and stored under
`/events/{eventSlug}` in Firestore.

## Frontend Configuration

Create `web/.env` from `web/.env.example`.

```bash
cp web/.env.example web/.env
```

Important frontend variables:

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Express API origin, usually `http://localhost:3000`. |
| `VITE_AUTH_MODE` | Use `firebase` for real login. `mock` is only for local scaffold tests. |
| `VITE_FIREBASE_API_KEY` | Firebase Web API key. |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain. |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID. |
| `VITE_FIREBASE_APP_ID` | Firebase app ID. |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID. |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket, if used. |

## Run Locally

Start the Express API:

```bash
npm start
```

The API listens on `http://localhost:3000` by default.

Start the React app:

```bash
npm --prefix web run dev
```

The Vite app listens on `http://localhost:5173` by default.

## Main Web Routes

When no event slug is present, the app shows the event list.

| Route | Purpose |
| --- | --- |
| `/` | Event list and event entry point. |
| `/admin/event` | Admin event list and event creation. |
| `/:eventSlug` | Event dashboard. |
| `/:eventSlug/admin` | Event configuration. |
| `/:eventSlug/admin/swoogo` | Event Swoogo credentials and registration types. |
| `/:eventSlug/admin/sendgrid` | Event SendGrid sender, API key, templates, and mapping. |
| `/:eventSlug/admin/queues-terminals` | Queue and terminal management. |
| `/:eventSlug/admin/users` | Event members, Firebase users, roles, and scopes. |
| `/:eventSlug/admin/areas-sessions` | Areas and sessions. |
| `/:eventSlug/checkin` | Pre-check-in scanner flow. |
| `/:eventSlug/print` | Print/pickup terminal UI. |
| `/:eventSlug/scan` | Mobile scanner for sessions and areas. |
| `/:eventSlug/layout` | Badge layout editor. |
| `/:eventSlug/attendees` | Attendee list and credential reissue actions. |

## Print Worker

The print worker is intended for local printer hosts such as macOS machines or
Raspberry Pi devices. It loads the root `.env` for Firebase Admin access, then
saves local terminal configuration under:

```text
~/.config/swoogo-selfcheckin/print-worker-config.json
```

Run interactive setup and start watching for jobs:

```bash
npm run print:worker:watch
```

Or run directly:

```bash
node workers/print-worker/index.js --mode=watch
```

On first run, the worker lists credentialing events from Firestore, asks for a
terminal name, printer type, printer queue, and API base URL, then registers the
terminal under the selected event.

If the terminal is later removed from the admin UI, the worker detects that the
saved terminal no longer exists and asks whether to re-register with current
local data or start a new terminal setup from scratch.

Dry-run and test helpers:

```bash
npm run print:worker
npm run test:print
```

## Tests

Run all backend, Firestore contract, and print-worker tests:

```bash
npm test
```

Run frontend unit/type tests:

```bash
npm run test:web
npm --prefix web run typecheck
```

## Firestore

Operational credentialing data uses the named Firestore database
`attendee-registry`, not the project default database.

Key top-level collection:

```text
/events/{eventSlug}
```

Event subcollections include participants, credentials, print jobs, queues,
terminals, sessions, areas, gates, members, access logs, and scanner activity.

See:

- [Firestore model](docs/firestore-model.md)
- [Security model](docs/security-model.md)
- [Firestore rules](firestore.rules)
- [Firestore indexes](firestore.indexes.json)

## Documentation

- [Automatic event credentialing system](docs/automatic-event-credentialing.md)
- [Implementation backlog](docs/implementation-backlog.md)
- [Frontend architecture](docs/frontend-architecture.md)
- [Printing runbook](docs/printing-runbook.md)
- [Security model](docs/security-model.md)
- [Firestore model](docs/firestore-model.md)
- Backlog slices:
  - [Backend integrations](docs/backlog/backend-integrations.md)
  - [Frontend apps](docs/backlog/frontend-apps.md)
  - [Printing deployment](docs/backlog/printing-deployment.md)
  - [Data, security, and analytics](docs/backlog/data-security-analytics.md)

## Secrets Policy

Do not commit `.env`, `.env.*`, `web/.env`, service account files, printer local
config files, SendGrid API keys, or Swoogo credentials. The repository tracks
only templates and documentation for configuration.
