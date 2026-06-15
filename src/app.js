const express = require("express");
const packageJson = require("../package.json");
const { createEventsAdminRouter, createEventRouter } = require("./api/events");
const { createFirestoreEventStore } = require("./api/event-store");
const { notFound } = require("./api/errors");
const { hasFirebaseAdminConfig } = require("./api/firebase-admin");
const { errorHandler, requestIdMiddleware, requestLogger } = require("./api/middleware");
const { sendSuccess } = require("./api/responses");

const DEFAULT_DEV_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
]);

function parseAllowedOrigins(value) {
  if (!value) {
    return DEFAULT_DEV_ORIGINS;
  }

  return new Set(value.split(",").map((origin) => origin.trim()).filter(Boolean));
}

function corsMiddleware(options = {}) {
  const allowedOrigins = parseAllowedOrigins(options.allowedOrigins || process.env.CORS_ORIGINS);

  return (request, response, next) => {
    const origin = request.get("origin");

    if (origin && allowedOrigins.has(origin)) {
      response.set("access-control-allow-origin", origin);
      response.set("vary", "Origin");
      response.set("access-control-allow-headers", "authorization,content-type,x-request-id");
      response.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    }

    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }

    next();
  };
}

function createDefaultEventStore(options) {
  if (options.eventStore) {
    return options.eventStore;
  }

  if (hasFirebaseAdminConfig()) {
    return createFirestoreEventStore();
  }

  return null;
}

function createApp(options = {}) {
  const app = express();
  const eventStore = createDefaultEventStore(options);

  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(requestLogger(options.logger === undefined ? console : options.logger));
  app.use(corsMiddleware(options.cors));
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_request, response) => {
    sendSuccess(response, {
      name: packageJson.name,
      version: packageJson.version,
      status: "ok",
    });
  });

  app.get("/health", (_request, response) => {
    sendSuccess(response, { status: "ok" });
  });

  if (eventStore) {
    app.use(
      "/api",
      createEventsAdminRouter({
        allowTestHeaders: options.allowTestHeaders,
        authVerifier: options.authVerifier,
        eventStore,
      }),
    );
  }

  app.use(
    "/api/events/:eventId",
    createEventRouter({
      allowTestHeaders: options.allowTestHeaders,
      authVerifier: options.authVerifier,
      membershipLoader: options.membershipLoader || eventStore?.loadMembership,
    }),
  );

  app.use((_request, _response, next) => {
    next(notFound());
  });

  app.use(errorHandler(options.logger === undefined ? console : options.logger));

  return app;
}

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;
