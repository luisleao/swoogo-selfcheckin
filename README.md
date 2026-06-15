# swoogo-selfchecking

Express service for the Swoogo self check-in project.

## Requirements

- Node.js 18+

## Setup

```bash
npm install
```

## Run

```bash
npm start
```

The service listens on `PORT` when provided, or `3000` by default.

## Backend Environment

The Express API reads `.env` at startup.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. Defaults to `3000`. |
| `FIREBASE_PROJECT_ID` | Firebase project used by Firebase Admin. |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account client email. |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key. |
| `BOOTSTRAP_EVENT_MANAGER_UIDS` | Comma-separated Firebase Auth UIDs allowed to create or enable credentialing events before event memberships exist. |

## Endpoints

- `GET /` returns service metadata.
- `GET /health` returns service health.

## Test

```bash
npm test
```

The root test command runs the backend, Firestore contract, and local print worker tests.
Frontend tests are scoped to the Vite workspace:

```bash
npm run test:web
```

## Documentation

- [Automatic event credentialing system](docs/automatic-event-credentialing.md)
- [Implementation backlog](docs/implementation-backlog.md)
