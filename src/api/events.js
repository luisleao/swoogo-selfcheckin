const express = require("express");
const asyncHandler = require("./async-handler");
const { requireEventMembership, requireFirebaseAuth } = require("./auth");
const { forbidden, validationError } = require("./errors");
const { canManageCredentialingEvents } = require("./event-store");
const { sendSuccess } = require("./responses");

const EVENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const EVENT_STATUS_VALUES = new Set(["draft", "active", "paused", "archived"]);
const QUEUE_STATUS_VALUES = new Set(["active", "paused", "disabled"]);
const TERMINAL_STATUS_VALUES = new Set(["online", "offline", "disabled"]);
const TERMINAL_TYPE_VALUES = new Set(["pre-check-in", "print", "pickup"]);
const RESOURCE_STATUS_VALUES = new Set(["active", "paused", "disabled"]);
const SCOPE_MODE_VALUES = new Set(["all", "none", "selected"]);
const EVENT_ROLE_VALUES = new Set([
  "super_admin",
  "event_admin",
  "event_manager",
  "pre_checkin_operator",
  "print_operator",
  "pickup_operator",
  "session_operator",
  "gate_operator",
  "dashboard_viewer",
  "layout_editor",
]);

function validateEventId(request, _response, next) {
  const { eventId } = request.params;

  if (!EVENT_ID_PATTERN.test(eventId || "")) {
    next(
      validationError([
        {
          field: "eventId",
          message: "eventId must be a 1-80 character slug using lowercase letters, numbers, and hyphens",
        },
      ]),
    );
    return;
  }

  request.eventId = eventId;
  next();
}

function validateEventIdFromBody(request, _response, next) {
  const { eventId } = request.body || {};

  if (!EVENT_ID_PATTERN.test(eventId || "")) {
    next(
      validationError([
        {
          field: "eventId",
          message: "eventId must be a 1-80 character slug using lowercase letters, numbers, and hyphens",
        },
      ]),
    );
    return;
  }

  request.eventId = eventId;
  next();
}

function validateSlugParam(paramName) {
  return (request, _response, next) => {
    const value = request.params[paramName];

    if (!EVENT_ID_PATTERN.test(value || "")) {
      next(
        validationError([
          {
            field: paramName,
            message: `${paramName} must be a 1-80 character slug using lowercase letters, numbers, and hyphens`,
          },
        ]),
      );
      return;
    }

    next();
  };
}

function validateUidParam(request, _response, next) {
  const { uid } = request.params;

  if (typeof uid !== "string" || uid.trim().length === 0 || uid.includes("/")) {
    next(validationError([{ field: "uid", message: "uid is required" }]));
    return;
  }

  next();
}

function validateRoleUpsertBody(request, _response, next) {
  const body = request.body || {};
  const details = [];

  if (!Array.isArray(body.roles) || body.roles.length === 0) {
    details.push({ field: "roles", message: "roles must include at least one role" });
  } else {
    body.roles
      .filter((role) => !EVENT_ROLE_VALUES.has(role))
      .forEach((role) => {
        details.push({ field: "roles", message: `${role} is not a supported event role` });
      });
  }

  if (typeof body.email !== "string" || body.email.trim().length === 0) {
    details.push({ field: "email", message: "email is required" });
  }

  if (body.scopeModes !== undefined) {
    const scopeModes = body.scopeModes || {};
    ["areas", "gates", "queues", "sessions"].forEach((key) => {
      if (scopeModes[key] !== undefined && !SCOPE_MODE_VALUES.has(scopeModes[key])) {
        details.push({ field: `scopeModes.${key}`, message: "scope mode must be all, selected, or none" });
      }
    });
  }

  if (details.length > 0) {
    next(validationError(details));
    return;
  }

  next();
}

function validateUserCreateBody(request, _response, next) {
  const body = request.body || {};
  const details = [];

  if (typeof body.email !== "string" || !body.email.includes("@")) {
    details.push({ field: "email", message: "email is required" });
  }

  if (typeof body.password !== "string" || body.password.length < 6) {
    details.push({ field: "password", message: "password must have at least 6 characters" });
  }

  if (details.length > 0) {
    next(validationError(details));
    return;
  }

  next();
}

function validateEventUpsertBody(request, _response, next) {
  const body = request.body || {};
  const details = [];

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    details.push({ field: "name", message: "name is required" });
  }

  if (typeof body.timezone !== "string" || body.timezone.trim().length === 0) {
    details.push({ field: "timezone", message: "timezone is required" });
  }

  if (body.status !== undefined && !EVENT_STATUS_VALUES.has(body.status)) {
    details.push({
      field: "status",
      message: "status must be draft, active, paused, or archived",
    });
  }

  if (body.registration !== undefined && typeof body.registration !== "boolean") {
    details.push({ field: "registration", message: "registration must be a boolean" });
  }

  if (body.swoogoBaseUrl !== undefined) {
    try {
      // eslint-disable-next-line no-new
      new URL(body.swoogoBaseUrl);
    } catch {
      details.push({ field: "swoogoBaseUrl", message: "swoogoBaseUrl must be a valid URL" });
    }
  }

  if (details.length > 0) {
    next(validationError(details));
    return;
  }

  next();
}

function validateAreaBody(request, _response, next) {
  const body = request.body || {};
  const details = [];

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    details.push({ field: "name", message: "name is required" });
  }

  if (body.status !== undefined && !RESOURCE_STATUS_VALUES.has(body.status)) {
    details.push({ field: "status", message: "status must be active, paused, or disabled" });
  }

  if (body.registrationTypeIds !== undefined && !Array.isArray(body.registrationTypeIds)) {
    details.push({ field: "registrationTypeIds", message: "registrationTypeIds must be an array" });
  }

  if (details.length > 0) {
    next(validationError(details));
    return;
  }

  next();
}

function validateGateBody(request, _response, next) {
  const body = request.body || {};
  const details = [];

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    details.push({ field: "name", message: "name is required" });
  }

  if (body.status !== undefined && !RESOURCE_STATUS_VALUES.has(body.status)) {
    details.push({ field: "status", message: "status must be active, paused, or disabled" });
  }

  if (body.areaId !== undefined && typeof body.areaId !== "string") {
    details.push({ field: "areaId", message: "areaId must be a string" });
  }

  if (details.length > 0) {
    next(validationError(details));
    return;
  }

  next();
}

function validateSessionBody(request, _response, next) {
  const body = request.body || {};
  const details = [];

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    details.push({ field: "name", message: "name is required" });
  }

  if (body.status !== undefined && !RESOURCE_STATUS_VALUES.has(body.status)) {
    details.push({ field: "status", message: "status must be active, paused, or disabled" });
  }

  if (body.swoogoSessionId !== undefined && typeof body.swoogoSessionId !== "string") {
    details.push({ field: "swoogoSessionId", message: "swoogoSessionId must be a string" });
  }

  if (body.areaId !== undefined && typeof body.areaId !== "string") {
    details.push({ field: "areaId", message: "areaId must be a string" });
  }

  if (details.length > 0) {
    next(validationError(details));
    return;
  }

  next();
}

function validateQueueBody(request, _response, next) {
  const body = request.body || {};
  const details = [];

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    details.push({ field: "name", message: "name is required" });
  }

  if (body.status !== undefined && !QUEUE_STATUS_VALUES.has(body.status)) {
    details.push({ field: "status", message: "status must be active, paused, or disabled" });
  }

  if (body.registrationTypeIds !== undefined && !Array.isArray(body.registrationTypeIds)) {
    details.push({ field: "registrationTypeIds", message: "registrationTypeIds must be an array" });
  }

  if (details.length > 0) {
    next(validationError(details));
    return;
  }

  next();
}

function validateTerminalBody(request, _response, next) {
  const body = request.body || {};
  const details = [];

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    details.push({ field: "name", message: "name is required" });
  }

  if (body.status !== undefined && !TERMINAL_STATUS_VALUES.has(body.status)) {
    details.push({ field: "status", message: "status must be online, offline, or disabled" });
  }

  if (body.type !== undefined && !TERMINAL_TYPE_VALUES.has(body.type)) {
    details.push({ field: "type", message: "type must be pre-check-in, print, or pickup" });
  }

  if (body.queueIds !== undefined && !Array.isArray(body.queueIds)) {
    details.push({ field: "queueIds", message: "queueIds must be an array" });
  }

  if (details.length > 0) {
    next(validationError(details));
    return;
  }

  next();
}

function requireCredentialingEventManager(request, _response, next) {
  if (!canManageCredentialingEvents(request.actor)) {
    next(forbidden(
      "EVENT_MANAGER_REQUIRED",
      "A super_admin or event_manager user is required",
    ));
    return;
  }

  next();
}

function requireEventConfigurationManager(request, _response, next) {
  if (canManageCredentialingEvents(request.actor)) {
    next();
    return;
  }

  const roles = Array.isArray(request.eventRoles) ? request.eventRoles : [];

  if (roles.includes("event_admin") || roles.includes("event_manager")) {
    next();
    return;
  }

  next(forbidden(
    "EVENT_MANAGER_REQUIRED",
    "An event_admin or event_manager role is required",
  ));
}

function actorResponse(actor) {
  return {
    uid: actor.uid,
    email: actor.email,
    name: actor.name,
    globalRoles: actor.globalRoles,
  };
}

function contextResponse(request, extra = {}) {
  return {
    ...extra,
    eventId: request.eventId,
    actor: actorResponse(request.actor),
    roles: request.eventRoles,
    requestId: request.id,
  };
}

function createEventsAdminRouter(options = {}) {
  const router = express.Router();
  const eventStore = options.eventStore;
  const eventMembershipMiddleware = requireEventMembership({
    allowTestHeaders: options.allowTestHeaders,
    loadMembership: options.membershipLoader || eventStore.loadMembership,
  });

  const requireEventConfigurationContext = (request, response, next) => {
    if (canManageCredentialingEvents(request.actor)) {
      next();
      return;
    }

    eventMembershipMiddleware(request, response, next);
  };

  router.use(
    requireFirebaseAuth({
      allowTestHeaders: options.allowTestHeaders,
      verifyToken: options.authVerifier,
    }),
  );

  router.get(
    "/me/events",
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listCredentialingEvents(request.actor, { registrationOnly: false }));
    }),
  );

  router.get(
    "/events",
    asyncHandler(async (request, response) => {
      const registration = request.query.registration;

      if (registration !== undefined && registration !== "true") {
        throw validationError([
          {
            field: "registration",
            message: "Only registration=true event listing is supported",
          },
        ]);
      }

      sendSuccess(response, await eventStore.listCredentialingEvents(request.actor, { registrationOnly: true }));
    }),
  );

  router.post(
    "/events",
    requireCredentialingEventManager,
    validateEventIdFromBody,
    validateEventUpsertBody,
    asyncHandler(async (request, response) => {
      const event = await eventStore.createCredentialingEvent(
        request.eventId,
        request.body,
        request.actor,
      );

      sendSuccess(response, event, { status: 201 });
    }),
  );

  router.get(
    "/events/:eventId",
    validateEventId,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.getEvent(request.eventId, request.actor));
    }),
  );

  router.put(
    "/events/:eventId",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    validateEventUpsertBody,
    asyncHandler(async (request, response) => {
      sendSuccess(
        response,
        await eventStore.updateCredentialingEvent(request.eventId, request.body, request.actor),
      );
    }),
  );

  router.post(
    "/events/:eventId/registration",
    validateEventId,
    requireCredentialingEventManager,
    validateEventUpsertBody,
    asyncHandler(async (request, response) => {
      sendSuccess(
        response,
        await eventStore.enableCredentialingEvent(request.eventId, request.body, request.actor),
      );
    }),
  );

  router.get(
    "/events/:eventId/integrations/swoogo",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.getSwoogoConfig(request.eventId));
    }),
  );

  router.put(
    "/events/:eventId/integrations/swoogo",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveSwoogoConfig(request.eventId, request.body || {}, request.actor));
    }),
  );

  router.post(
    "/events/:eventId/integrations/swoogo/test",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.testSwoogoConfig(request.eventId, request.actor, request.body || {}));
    }),
  );

  router.post(
    "/events/:eventId/integrations/swoogo/registration-types/import",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.importSwoogoRegistrationTypes(request.eventId, request.actor, request.body || {}));
    }),
  );

  router.get(
    "/events/:eventId/integrations/sendgrid",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.getSendGridConfig(request.eventId));
    }),
  );

  router.put(
    "/events/:eventId/integrations/sendgrid",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveSendGridConfig(request.eventId, request.body || {}, request.actor));
    }),
  );

  router.post(
    "/events/:eventId/integrations/sendgrid/test",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.testSendGridConfig(request.eventId, request.actor, request.body || {}));
    }),
  );

  router.get(
    "/events/:eventId/integrations/sendgrid/templates",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listSendGridTemplates(request.eventId, request.actor));
    }),
  );

  router.post(
    "/events/:eventId/integrations/sendgrid/templates",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listSendGridTemplates(request.eventId, request.actor, request.body || {}));
    }),
  );

  router.get(
    "/events/:eventId/users",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listUsers(request.eventId));
    }),
  );

  router.post(
    "/events/:eventId/users",
    validateEventId,
    validateUserCreateBody,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.createUser(request.eventId, request.body || {}, request.actor), { status: 201 });
    }),
  );

  router.get(
    "/events/:eventId/roles",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listRoles(request.eventId));
    }),
  );

  router.put(
    "/events/:eventId/roles/:uid",
    validateEventId,
    validateUidParam,
    validateRoleUpsertBody,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveRole(request.eventId, request.params.uid, request.body || {}, request.actor));
    }),
  );

  router.get(
    "/events/:eventId/registration-types",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listRegistrationTypes(request.eventId, request.actor));
    }),
  );

  router.get(
    "/events/:eventId/attendees",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listAttendees(request.eventId));
    }),
  );

  router.post(
    "/events/:eventId/attendees/:attendeeId/credentials/reissue",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.reissueCredential(request.eventId, request.params.attendeeId, request.actor), { status: 201 });
    }),
  );

  router.get(
    "/events/:eventId/areas",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listAreas(request.eventId));
    }),
  );

  router.post(
    "/events/:eventId/areas",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    validateAreaBody,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveArea(request.eventId, null, request.body || {}, request.actor), { status: 201 });
    }),
  );

  router.put(
    "/events/:eventId/areas/:areaId",
    validateEventId,
    validateSlugParam("areaId"),
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    validateAreaBody,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveArea(request.eventId, request.params.areaId, request.body || {}, request.actor));
    }),
  );

  router.get(
    "/events/:eventId/gates",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listGates(request.eventId));
    }),
  );

  router.post(
    "/events/:eventId/gates",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    validateGateBody,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveGate(request.eventId, null, request.body || {}, request.actor), { status: 201 });
    }),
  );

  router.put(
    "/events/:eventId/gates/:gateId",
    validateEventId,
    validateSlugParam("gateId"),
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    validateGateBody,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveGate(request.eventId, request.params.gateId, request.body || {}, request.actor));
    }),
  );

  router.get(
    "/events/:eventId/sessions",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listSessions(request.eventId));
    }),
  );

  router.post(
    "/events/:eventId/sessions",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    validateSessionBody,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveSession(request.eventId, null, request.body || {}, request.actor), { status: 201 });
    }),
  );

  router.put(
    "/events/:eventId/sessions/:sessionId",
    validateEventId,
    validateSlugParam("sessionId"),
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    validateSessionBody,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveSession(request.eventId, request.params.sessionId, request.body || {}, request.actor));
    }),
  );

  router.get(
    "/events/:eventId/queues",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listQueues(request.eventId));
    }),
  );

  router.post(
    "/events/:eventId/queues",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    validateQueueBody,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveQueue(request.eventId, null, request.body, request.actor), { status: 201 });
    }),
  );

  router.put(
    "/events/:eventId/queues/:queueId",
    validateEventId,
    validateSlugParam("queueId"),
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    validateQueueBody,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveQueue(request.eventId, request.params.queueId, request.body, request.actor));
    }),
  );

  router.delete(
    "/events/:eventId/queues/:queueId",
    validateEventId,
    validateSlugParam("queueId"),
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.deleteQueue(request.eventId, request.params.queueId, request.actor));
    }),
  );

  router.get(
    "/events/:eventId/terminals",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.listTerminals(request.eventId));
    }),
  );

  router.post(
    "/events/:eventId/terminals",
    validateEventId,
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    validateTerminalBody,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveTerminal(request.eventId, null, request.body, request.actor), { status: 201 });
    }),
  );

  router.put(
    "/events/:eventId/terminals/:terminalId",
    validateEventId,
    validateSlugParam("terminalId"),
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    validateTerminalBody,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.saveTerminal(request.eventId, request.params.terminalId, request.body, request.actor));
    }),
  );

  router.delete(
    "/events/:eventId/terminals/:terminalId",
    validateEventId,
    validateSlugParam("terminalId"),
    requireEventConfigurationContext,
    requireEventConfigurationManager,
    asyncHandler(async (request, response) => {
      sendSuccess(response, await eventStore.deleteTerminal(request.eventId, request.params.terminalId, request.actor));
    }),
  );

  return router;
}

function createEventRouter(options = {}) {
  const router = express.Router({ mergeParams: true });

  router.use(validateEventId);
  router.use(
    requireFirebaseAuth({
      allowTestHeaders: options.allowTestHeaders,
      verifyToken: options.authVerifier,
    }),
  );
  router.use(
    requireEventMembership({
      allowTestHeaders: options.allowTestHeaders,
      loadMembership: options.membershipLoader,
    }),
  );

  router.get(
    "/health",
    asyncHandler(async (request, response) => {
      sendSuccess(response, contextResponse(request, { status: "ok" }));
    }),
  );

  router.get(
    "/context",
    asyncHandler(async (request, response) => {
      sendSuccess(response, contextResponse(request));
    }),
  );

  return router;
}

module.exports = {
  createEventsAdminRouter,
  createEventRouter,
  validateEventId,
};
