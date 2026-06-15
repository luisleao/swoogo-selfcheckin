# Frontend Architecture

## Scope

The frontend lives in `web/` as a standalone React, Vite, and TypeScript package. It is intentionally separate from the root Express package so frontend dependencies and scripts can evolve without changing the backend package files.

This scaffold covers the first frontend backlog slice:

- application foundation, static CSS, PWA metadata, service worker registration hook, unit and smoke-test setup;
- Firebase Auth boundary with Firebase Web SDK email/password sign-in and optional mock mode for development tests;
- event selection, event membership context, role-aware navigation, and route guards;
- Admin configuration screens for event setup, Swoogo, SendGrid, event members, areas/sessions, queues, and terminals;
- typed API helpers that attach a Firebase ID token from an injected provider.

## Package Layout

```text
web/
  index.html
  package.json
  playwright.config.ts
  public/
    manifest.webmanifest
    sw.js
  src/
    api/
      client.ts
      admin.ts
    auth/
      AuthBoundary.tsx
      AuthContext.tsx
    components/
      primitives.tsx
    config/
      env.ts
    context/
      ApiContext.tsx
      EventContext.tsx
    features/
      admin/
      app/
      routes/
    layouts/
      AppLayout.tsx
    styles.css
```

## Route Structure

Routes are declared in `web/src/App.tsx`. Navigation metadata is in `web/src/features/routes/routes.ts`.

| Route | Guard | Purpose |
| --- | --- | --- |
| `/login` | Public | Firebase Auth email/password sign-in screen. |
| `/` | Authenticated user | Credentialing event list and new event creation. |
| `/:eventSlug` | Event member + `dashboard_viewer` | Event statistics dashboard. |
| `/:eventSlug/admin` | Event member + `event_admin` or `event_manager` | Event detail editor for status, timezone, registration flag, and fallback print queue. |
| `/:eventSlug/admin/swoogo` | Event member + `event_admin` or `event_manager` | Swoogo event ID, base URL, API key/consumer key, consumer secret, and connection test. |
| `/:eventSlug/admin/sendgrid` | Event member + `event_admin` or `event_manager` | Sender, reply-to, API key, template mapping, and connection test. |
| `/:eventSlug/admin/users-roles` | Event member + `event_admin` | Event member management. The add-member modal can select existing Firebase Auth users that are not members yet, or create a new Firebase Auth user before saving roles. |
| `/:eventSlug/admin/areas-sessions` | Event member + `event_admin` or `event_manager` | Access area and session configuration. Sessions can move attendees into a linked area. |
| `/:eventSlug/admin/queues-terminals` | Event member + `event_admin` or `event_manager` | Print queues, registration-type routing, terminal assignment, and dependency confirmation. |
| `/:eventSlug/attendees` | Event member + `event_admin` or `event_manager` | Firestore attendee list with manual credential reissue. |
| `/:eventSlug/checkin` | Active event + `pre_checkin_operator` | Full-screen JSQR camera scanner with email fallback and automatic queue routing. |
| `/:eventSlug/print` | Active event + `print_operator` or `pickup_operator` | Print queue and pickup scaffold with local terminal identity display. |
| `/:eventSlug/scan` | Active event + `session_operator` or `gate_operator` | Unified badge scanner for either a selected Swoogo session or a selected access area. |
| `/:eventSlug/layout` | Event member + `layout_editor` | Badge layout editor with label type, field visibility, name mode, and drag/drop positioning. |

System routes exist for blocked states: `/event-required`, `/inactive-member`, `/inactive-event`, `/missing-terminal`, and `/no-access`.

## Role Guards

The route guard chain is:

1. `RequireAuth` waits for Firebase session resolution and blocks unauthenticated users before the app shell loads.
2. The event admin route can open for `super_admin` and global `event_manager` users even before any credentialing event exists, so the first event can be created.
3. `RequireEvent` requires a selected event and active event membership for event-scoped admin and operational routes.
4. `RequireActiveEvent` blocks operational routes when the selected event is not active.
5. `RoleGuard` checks event-scoped roles before rendering route content.

`event_admin` currently passes all role checks in the scaffold. Backend enforcement must remain the source of truth for every sensitive read or mutation.

The event selector persists `swoogo.event.selected` in `localStorage`. Switching events clears persisted terminal, session, and area access selections so operators cannot carry incompatible operational context across events.

The print terminal interface reads and writes `swoogo.terminal.identity` in browser
`localStorage` so operators can see the local terminal name and terminal ID while the
backend terminal enrollment API is still pending. The local print worker stores its own
machine identity in `~/.config/swoogo-selfcheckin/print-terminal.json`; the backend will
later reconcile both through `events/{eventId}/printTerminals/{terminalId}`.

## Auth Boundary

`web/src/auth/AuthBoundary.tsx` is named as the Firebase Auth boundary. The current implementation uses Firebase Web SDK when `VITE_AUTH_MODE=firebase`, which is the default. It initializes Firebase from `VITE_FIREBASE_*`, subscribes to auth state changes, supports email/password sign-in through Firebase Auth, and calls `currentUser.getIdToken()` inside the injected provider for API requests.

Mock mode still exists for local scaffold tests, but it must be explicitly enabled with `VITE_AUTH_MODE=mock`.

## Environment Variables

`web/.env.example` lists the supported variables.

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Express API origin, for example `http://localhost:3000`. |
| `VITE_AUTH_MODE` | `firebase` for normal use, or `mock` only for scaffold/dev tests. |
| `VITE_DEFAULT_APP_MODE` | Initial mode hint for future terminal/mobile entry points. |
| `VITE_ENABLE_PWA` | Feature flag for PWA UI behavior. |
| `VITE_ENABLE_SERVICE_WORKER` | Registers `public/sw.js` when set to true. |
| `VITE_FIREBASE_API_KEY` | Firebase Web API key. |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain. |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID. |
| `VITE_FIREBASE_APP_ID` | Firebase app ID. |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID. |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket, if needed later. |

## API Client Contract

`web/src/api/client.ts` exports `createApiClient`. It accepts:

- `baseUrl`;
- `tokenProvider.getIdToken`;
- optional `fetcher`, useful for tests;
- optional `onUnauthorized`.

Every request calls `tokenProvider.getIdToken()` and, when a token is returned, sends:

```http
Authorization: Bearer <firebase-id-token>
Accept: application/json
```

JSON request bodies also receive `Content-Type: application/json`.

`web/src/api/admin.ts` contains typed helper methods for the expected Express API shape. The scaffold assumes these endpoints will be implemented by backend workers:

- `GET /api/me/events`
- `GET /api/events?registration=true`
- `POST /api/events`
- `GET /api/events/:eventId`
- `POST /api/events/:eventId/registration`
- `PUT /api/events/:eventId`
- `GET /api/events/:eventId/roles`
- `GET /api/events/:eventId/queues`
- `GET /api/events/:eventId/terminals`
- `PUT /api/events/:eventId/integrations/swoogo`
- `POST /api/events/:eventId/integrations/swoogo/test`
- `PUT /api/events/:eventId/integrations/sendgrid`
- `POST /api/events/:eventId/integrations/sendgrid/test`

Clients must not write secrets, counters, role changes, integration tests, scan decisions, credential void/reissue actions, or audit records directly to Firestore. Those operations should go through the authenticated Express API.

## PWA And Offline Behavior

The scaffold includes installability metadata in `public/manifest.webmanifest`, a minimal shell service worker in `public/sw.js`, and `registerServiceWorker()` behind `VITE_ENABLE_SERVICE_WORKER`.

The app shell shows online/offline state through `useOnlineStatus`. Offline execution is only a shell capability at this stage. Scanner workflows should stay online-only until each workflow has an explicit backend-approved offline policy.

## Test Strategy

The package includes:

- Vitest setup in `vite.config.ts` and `src/test/setup.ts`;
- a unit test proving the API client attaches the injected Firebase ID token;
- Playwright smoke tests for the unauthenticated login route and a mocked authenticated admin route.

Run after dependencies are installed:

```bash
cd web
npm install
npm run typecheck
npm run lint
npm run test
npm run test:smoke
```
