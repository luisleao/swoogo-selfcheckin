const asyncHandler = require("./async-handler");
const { ApiError, forbidden, unauthorized } = require("./errors");
const { verifyFirebaseIdToken } = require("./firebase-admin");

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function normalizeRoles(value) {
  if (Array.isArray(value)) {
    return value
      .map((role) => (typeof role === "string" ? role.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeList(value) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function addRole(roles, role) {
  if (!roles.includes(role)) {
    roles.push(role);
  }
}

function applyBootstrapManagerRole(actor, env = process.env) {
  const managerUids = normalizeList(env.BOOTSTRAP_EVENT_MANAGER_UIDS);
  const managerEmails = normalizeList(env.BOOTSTRAP_EVENT_MANAGER_EMAILS).map((email) => email.toLowerCase());

  if (managerUids.includes(actor.uid) || (actor.email && managerEmails.includes(actor.email.toLowerCase()))) {
    addRole(actor.globalRoles, "event_manager");
  }

  return actor;
}

function readBearerToken(request) {
  const authorization = request.get("authorization");

  if (!authorization) {
    throw unauthorized("AUTH_TOKEN_MISSING", "Authorization bearer token is required");
  }

  const match = authorization.match(BEARER_PATTERN);
  if (!match) {
    throw unauthorized("AUTH_TOKEN_MALFORMED", "Authorization header must use Bearer scheme");
  }

  const token = match[1].trim();
  if (!JWT_PATTERN.test(token)) {
    throw unauthorized("AUTH_TOKEN_MALFORMED", "Bearer token must be JWT-shaped");
  }

  return token;
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== "object") {
    throw unauthorized("AUTH_TOKEN_INVALID", "Authenticated actor is invalid");
  }

  const uid = actor.uid || actor.sub || actor.userId;
  if (typeof uid !== "string" || uid.length === 0) {
    throw unauthorized("AUTH_TOKEN_INVALID", "Authenticated actor requires a uid");
  }

  const globalRoles = normalizeRoles(actor.globalRoles || actor.roles);

  if (actor.superAdmin === true) {
    addRole(globalRoles, "super_admin");
  }

  return applyBootstrapManagerRole({
    uid,
    email: typeof actor.email === "string" ? actor.email : null,
    name: typeof actor.name === "string" ? actor.name : null,
    globalRoles,
    eventMemberships:
      actor.eventMemberships && typeof actor.eventMemberships === "object"
        ? actor.eventMemberships
        : {},
  });
}

function actorFromTestHeaders(request) {
  const uid = request.get("x-test-user-id");
  if (!uid) {
    return null;
  }

  return normalizeActor({
    uid,
    email: request.get("x-test-user-email"),
    name: request.get("x-test-user-name"),
    globalRoles: request.get("x-test-global-roles"),
  });
}

function requireFirebaseAuth(options = {}) {
  const verifyToken = options.verifyToken || verifyFirebaseIdToken;
  const allowTestHeaders = options.allowTestHeaders === true;

  return asyncHandler(async (request, _response, next) => {
    const token = readBearerToken(request);
    const testActor = allowTestHeaders ? actorFromTestHeaders(request) : null;
    let actor = testActor;

    if (!actor) {
      try {
        actor = await verifyToken(token, request);
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }

        throw unauthorized("AUTH_TOKEN_INVALID", "Bearer token could not be verified", {
          cause: error,
        });
      }
    }

    request.actor = normalizeActor(actor);
    next();
  });
}

function membershipFromActorClaims(actor, eventId) {
  if (actor.globalRoles.includes("super_admin")) {
    return {
      active: true,
      roles: ["super_admin"],
      source: "global_role",
    };
  }

  const claim = Object.prototype.hasOwnProperty.call(actor.eventMemberships, eventId)
    ? actor.eventMemberships[eventId]
    : null;
  if (!claim) {
    return null;
  }

  if (Array.isArray(claim) || typeof claim === "string") {
    return {
      active: true,
      roles: normalizeRoles(claim),
      source: "token_claim",
    };
  }

  return {
    active: claim.active !== false,
    roles: normalizeRoles(claim.roles),
    allowedQueues: Array.isArray(claim.allowedQueues) ? claim.allowedQueues : [],
    allowedSessions: Array.isArray(claim.allowedSessions) ? claim.allowedSessions : [],
    allowedAreas: Array.isArray(claim.allowedAreas) ? claim.allowedAreas : [],
    allowedGates: Array.isArray(claim.allowedGates) ? claim.allowedGates : [],
    source: "token_claim",
  };
}

function membershipFromTestHeaders(request) {
  const roles = normalizeRoles(request.get("x-test-event-roles"));
  if (roles.length === 0) {
    return null;
  }

  return {
    active: request.get("x-test-event-active") !== "false",
    roles,
    source: "test_headers",
  };
}

function normalizeMembership(membership, eventId, actor) {
  if (!membership || typeof membership !== "object") {
    throw forbidden();
  }

  const roles = normalizeRoles(membership.roles);
  if (membership.active === false || roles.length === 0) {
    throw forbidden();
  }

  return {
    eventId,
    uid: actor.uid,
    active: true,
    roles,
    allowedQueues: Array.isArray(membership.allowedQueues)
      ? membership.allowedQueues
      : Array.isArray(membership.allowedQueueIds)
        ? membership.allowedQueueIds
        : [],
    allowedSessions: Array.isArray(membership.allowedSessions)
      ? membership.allowedSessions
      : Array.isArray(membership.allowedSessionIds)
        ? membership.allowedSessionIds
        : [],
    allowedAreas: Array.isArray(membership.allowedAreas)
      ? membership.allowedAreas
      : Array.isArray(membership.allowedAreaIds)
        ? membership.allowedAreaIds
        : [],
    allowedGates: Array.isArray(membership.allowedGates)
      ? membership.allowedGates
      : Array.isArray(membership.allowedGateIds)
        ? membership.allowedGateIds
        : [],
    source: membership.source || "placeholder",
  };
}

function requireEventMembership(options = {}) {
  const loadMembership = options.loadMembership;
  const allowTestHeaders = options.allowTestHeaders === true;

  return asyncHandler(async (request, _response, next) => {
    const actor = request.actor;
    const eventId = request.eventId;

    if (!actor) {
      throw unauthorized();
    }

    const membership =
      (loadMembership &&
        (await loadMembership({
          actor,
          eventId,
          request,
        }))) ||
      (allowTestHeaders ? membershipFromTestHeaders(request) : null) ||
      membershipFromActorClaims(actor, eventId);

    request.eventMembership = normalizeMembership(membership, eventId, actor);
    request.eventRoles = request.eventMembership.roles;
    request.auditContext = {
      requestId: request.id,
      eventId,
      actorId: actor.uid,
      roles: request.eventRoles,
    };

    next();
  });
}

module.exports = {
  normalizeRoles,
  requireEventMembership,
  requireFirebaseAuth,
};
