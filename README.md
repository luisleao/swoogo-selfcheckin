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

## Endpoints

- `GET /` returns service metadata.
- `GET /health` returns service health.

## Test

```bash
npm test
```
