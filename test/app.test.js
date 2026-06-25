const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp } = require("../src/app");

function listen(app = createApp({ logger: null })) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", (error) => {
      if (error) {
        reject(error);
        return;
      }

      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });

    server.once("error", reject);
  });
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeJwt(payload = { sub: "user-1" }) {
  return `${encodeJson({ alg: "none", typ: "JWT" })}.${encodeJson(payload)}.signature`;
}

test("GET /health returns ok", async () => {
  const { server, baseUrl } = await listen();

  try {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, { status: "ok" });
    assert.equal(body.requestId, response.headers.get("x-request-id"));
  } finally {
    server.close();
  }
});

test("unknown routes return 404", async () => {
  const { server, baseUrl } = await listen();

  try {
    const response = await fetch(`${baseUrl}/missing`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.ok, false);
    assert.deepEqual(body.error, { code: "NOT_FOUND", message: "Not Found" });
    assert.equal(body.requestId, response.headers.get("x-request-id"));
  } finally {
    server.close();
  }
});

test("event routes reject invalid event ids with field details", async () => {
  const { server, baseUrl } = await listen();

  try {
    const response = await fetch(`${baseUrl}/api/events/!/health`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.deepEqual(body.error.details, [
      {
        field: "eventId",
        message: "eventId must be a 1-80 character slug using lowercase letters, numbers, and hyphens",
      },
    ]);
  } finally {
    server.close();
  }
});

test("protected event routes reject missing bearer tokens", async () => {
  const { server, baseUrl } = await listen();

  try {
    const response = await fetch(`${baseUrl}/api/events/event-123/health`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
    assert.deepEqual(body.error, {
      code: "AUTH_TOKEN_MISSING",
      message: "Authorization bearer token is required",
    });
  } finally {
    server.close();
  }
});

test("protected event routes reject actors without event membership", async () => {
  const app = createApp({
    logger: null,
    authVerifier: async () => ({
      uid: "user-1",
    }),
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/event-123/context`, {
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "user-1" })}`,
      },
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.ok, false);
    assert.deepEqual(body.error, { code: "FORBIDDEN", message: "Forbidden" });
  } finally {
    server.close();
  }
});

test("authenticated event context includes event, actor, roles, and request id", async () => {
  const app = createApp({
    logger: null,
    authVerifier: async (token) => {
      assert.equal(token, fakeJwt({ sub: "ignored-by-stub" }));

      return {
        uid: "firebase-user-1",
        email: "operator@example.com",
        name: "Ada Operator",
      };
    },
    membershipLoader: async ({ actor, eventId }) => {
      assert.equal(actor.uid, "firebase-user-1");
      assert.equal(eventId, "event-123");

      return {
        active: true,
        roles: ["event_manager", "viewer"],
      };
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/event-123/context`, {
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "ignored-by-stub" })}`,
        "x-request-id": "req-test-123",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), "req-test-123");
    assert.deepEqual(body, {
      ok: true,
      data: {
        eventId: "event-123",
        actor: {
          uid: "firebase-user-1",
          email: "operator@example.com",
          name: "Ada Operator",
          globalRoles: [],
        },
        roles: ["event_manager", "viewer"],
        requestId: "req-test-123",
      },
      requestId: "req-test-123",
    });
  } finally {
    server.close();
  }
});

test("authenticated event health returns scoped status", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    authVerifier: async () => ({
      uid: "header-user",
    }),
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/event-123/health`, {
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "header-user" })}`,
        "x-test-event-roles": "viewer",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.status, "ok");
    assert.equal(body.data.eventId, "event-123");
    assert.deepEqual(body.data.roles, ["viewer"]);
  } finally {
    server.close();
  }
});

test("GET /api/events lists credentialing events for super admins", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      listCredentialingEvents: async (actor) => {
        assert.equal(actor.uid, "super-user");
        assert.deepEqual(actor.globalRoles, ["super_admin"]);

        return [
          {
            id: "event-2026",
            name: "Event 2026",
            registration: true,
            status: "active",
            timezone: "America/Sao_Paulo",
          },
        ];
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events?registration=true`, {
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "super-user" })}`,
        "x-test-global-roles": "super_admin",
        "x-test-user-id": "super-user",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data, [
      {
        id: "event-2026",
        name: "Event 2026",
        registration: true,
        status: "active",
        timezone: "America/Sao_Paulo",
      },
    ]);
  } finally {
    server.close();
  }
});

test("POST /api/events creates a credentialing event with a slug id", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      createCredentialingEvent: async (eventId, body, actor) => {
        assert.equal(eventId, "event-2026");
        assert.equal(actor.uid, "super-user");
        assert.equal(body.name, "Event 2026");
        assert.equal(body.swoogoEventId, "8048");

        return {
          id: eventId,
          name: body.name,
          registration: true,
          status: body.status,
          swoogoEventId: body.swoogoEventId,
          timezone: body.timezone,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events`, {
      body: JSON.stringify({
        eventId: "event-2026",
        name: "Event 2026",
        status: "draft",
        swoogoEventId: "8048",
        timezone: "America/Sao_Paulo",
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "super-user" })}`,
        "content-type": "application/json",
        "x-test-global-roles": "super_admin",
        "x-test-user-id": "super-user",
      },
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.data.id, "event-2026");
    assert.equal(body.data.registration, true);
  } finally {
    server.close();
  }
});

test("POST /api/events allows a global event_manager to create a Firestore event", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      createCredentialingEvent: async (eventId, body, actor) => {
        assert.equal(eventId, "manager-event");
        assert.equal(actor.uid, "manager-user");
        assert.deepEqual(actor.globalRoles, ["event_manager"]);

        return {
          id: eventId,
          name: body.name,
          registration: true,
          status: body.status,
          timezone: body.timezone,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events`, {
      body: JSON.stringify({
        eventId: "manager-event",
        name: "Manager Event",
        status: "draft",
        timezone: "America/Sao_Paulo",
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "content-type": "application/json",
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.data.id, "manager-event");
    assert.equal(body.data.registration, true);
  } finally {
    server.close();
  }
});

test("POST /api/events allows a bootstrap manager UID to create a Firestore event", async () => {
  const originalBootstrapUids = process.env.BOOTSTRAP_EVENT_MANAGER_UIDS;
  process.env.BOOTSTRAP_EVENT_MANAGER_UIDS = "bootstrap-user";

  const app = createApp({
    logger: null,
    authVerifier: async () => ({
      email: "signal@leao.dev",
      uid: "bootstrap-user",
    }),
    eventStore: {
      createCredentialingEvent: async (eventId, body, actor) => {
        assert.equal(eventId, "bootstrap-event");
        assert.equal(actor.uid, "bootstrap-user");
        assert.deepEqual(actor.globalRoles, ["event_manager"]);

        return {
          id: eventId,
          name: body.name,
          registration: true,
          status: body.status,
          timezone: body.timezone,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events`, {
      body: JSON.stringify({
        eventId: "bootstrap-event",
        name: "Bootstrap Event",
        status: "draft",
        timezone: "America/Sao_Paulo",
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "bootstrap-user" })}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.data.id, "bootstrap-event");
    assert.equal(body.data.registration, true);
  } finally {
    if (originalBootstrapUids === undefined) {
      delete process.env.BOOTSTRAP_EVENT_MANAGER_UIDS;
    } else {
      process.env.BOOTSTRAP_EVENT_MANAGER_UIDS = originalBootstrapUids;
    }

    server.close();
  }
});

test("POST /api/events/:eventId/registration enables credentialing on an existing event", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      enableCredentialingEvent: async (eventId, body, actor) => {
        assert.equal(eventId, "existing-event");
        assert.equal(actor.uid, "super-user");
        assert.equal(body.name, "Existing Event");

        return {
          id: eventId,
          name: body.name,
          registration: true,
          status: "active",
          timezone: body.timezone,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/existing-event/registration`, {
      body: JSON.stringify({
        name: "Existing Event",
        status: "active",
        timezone: "America/Sao_Paulo",
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "super-user" })}`,
        "content-type": "application/json",
        "x-test-global-roles": "super_admin",
        "x-test-user-id": "super-user",
      },
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.id, "existing-event");
    assert.equal(body.data.registration, true);
  } finally {
    server.close();
  }
});

test("PUT /api/events/:eventId updates a credentialing event", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      updateCredentialingEvent: async (eventId, body, actor) => {
        assert.equal(eventId, "existing-event");
        assert.equal(actor.uid, "manager-user");
        assert.equal(body.name, "Updated Event");
        assert.equal(body.registration, false);
        assert.equal(body.swoogoEventId, "9999");

        return {
          id: eventId,
          name: body.name,
          registration: body.registration,
          status: body.status,
          swoogoEventId: body.swoogoEventId,
          timezone: body.timezone,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/existing-event`, {
      body: JSON.stringify({
        name: "Updated Event",
        registration: false,
        status: "active",
        swoogoEventId: "9999",
        timezone: "America/Sao_Paulo",
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "content-type": "application/json",
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "PUT",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.id, "existing-event");
    assert.equal(body.data.name, "Updated Event");
    assert.equal(body.data.registration, false);
    assert.equal(body.data.swoogoEventId, "9999");
  } finally {
    server.close();
  }
});

test("PUT /api/events/:eventId allows an event admin membership", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    authVerifier: async () => ({
      uid: "event-admin-user",
    }),
    eventStore: {
      updateCredentialingEvent: async (eventId, body, actor) => {
        assert.equal(eventId, "member-event");
        assert.equal(actor.uid, "event-admin-user");

        return {
          id: eventId,
          name: body.name,
          registration: true,
          status: body.status,
          timezone: body.timezone,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/member-event`, {
      body: JSON.stringify({
        name: "Member Managed Event",
        status: "active",
        timezone: "America/Sao_Paulo",
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "event-admin-user" })}`,
        "content-type": "application/json",
        "x-test-event-roles": "event_admin",
      },
      method: "PUT",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.id, "member-event");
    assert.equal(body.data.name, "Member Managed Event");
  } finally {
    server.close();
  }
});

test("PUT /api/events/:eventId/integrations/swoogo saves event Swoogo config", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      saveSwoogoConfig: async (eventId, body, actor) => {
        assert.equal(eventId, "manager-event");
        assert.equal(actor.uid, "manager-user");
        assert.equal(body.eventId, "8048");
        assert.equal(body.clientId, "swoogo-client");
        assert.equal(body.clientSecret, "swoogo-secret");

        return {
          baseUrl: body.baseUrl,
          credentialsConfigured: true,
          credentialsUpdatedAt: "2026-06-14T12:00:00.000Z",
          eventId: body.eventId,
          lastTest: { checkedAt: null, message: "Not tested", status: "untested" },
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/integrations/swoogo`, {
      body: JSON.stringify({
        baseUrl: "https://api.swoogo.com",
        clientId: "swoogo-client",
        clientSecret: "swoogo-secret",
        eventId: "8048",
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "content-type": "application/json",
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "PUT",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.eventId, "8048");
    assert.equal(body.data.credentialsConfigured, true);
  } finally {
    server.close();
  }
});

test("POST /api/events/:eventId/integrations/swoogo/test forwards draft credentials", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      testSwoogoConfig: async (eventId, actor, body) => {
        assert.equal(eventId, "manager-event");
        assert.equal(actor.uid, "manager-user");
        assert.equal(body.baseUrl, "https://api.swoogo.com");
        assert.equal(body.eventId, "8048");
        assert.equal(body.consumerKey, "draft-key");
        assert.equal(body.consumerSecret, "draft-secret");

        return {
          checkedAt: "2026-06-14T12:00:00.000Z",
          message: "Swoogo configuration is present.",
          status: "success",
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/integrations/swoogo/test`, {
      body: JSON.stringify({
        baseUrl: "https://api.swoogo.com",
        consumerKey: "draft-key",
        consumerSecret: "draft-secret",
        eventId: "8048",
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "content-type": "application/json",
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.status, "success");
  } finally {
    server.close();
  }
});

test("POST /api/events/:eventId/integrations/swoogo/participants/import imports registrants", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      importSwoogoParticipants: async (eventId, actor, body) => {
        assert.equal(eventId, "manager-event");
        assert.equal(actor.uid, "manager-user");
        assert.equal(body.perPage, 250);

        return {
          createdCount: 2,
          importedCount: 3,
          participantIds: ["101", "102", "103"],
          skippedCount: 0,
          updatedCount: 1,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/integrations/swoogo/participants/import`, {
      body: JSON.stringify({
        perPage: 250,
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "content-type": "application/json",
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.importedCount, 3);
    assert.equal(body.data.createdCount, 2);
    assert.equal(body.data.updatedCount, 1);
  } finally {
    server.close();
  }
});

test("DELETE /api/events/:eventId/integrations/swoogo/cache clears Swoogo cache", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      clearSwoogoCache: async (eventId, actor) => {
        assert.equal(eventId, "manager-event");
        assert.equal(actor.uid, "manager-user");

        return {
          config: {
            baseUrl: "https://api.swoogo.com",
            credentialsConfigured: true,
            credentialsUpdatedAt: null,
            eventId: "8048",
            lastTest: { checkedAt: null, message: "Not tested", status: "untested" },
            registrationTypeCount: 0,
          },
          participantsDeletedCount: 4,
          participantsSkippedCount: 1,
          registrationTypesDeletedCount: 2,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/integrations/swoogo/cache`, {
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "DELETE",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.participantsDeletedCount, 4);
    assert.equal(body.data.participantsSkippedCount, 1);
    assert.equal(body.data.registrationTypesDeletedCount, 2);
    assert.equal(body.data.config.registrationTypeCount, 0);
  } finally {
    server.close();
  }
});

test("GET /api/events/:eventId/attendees/:attendeeId returns attendee detail", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      getAttendeeDetail: async (eventId, attendeeId) => {
        assert.equal(eventId, "manager-event");
        assert.equal(attendeeId, "101");

        return {
          areaPassages: [],
          attendee: {
            activeBadgeId: "badge-1",
            company: "Acme",
            credentialStatus: "issued",
            email: "ana@example.com",
            id: "101",
            jobTitle: "Producer",
            name: "Ana Silva",
            registrationTypeId: "vip",
            swoogoRegistrantId: "101",
          },
          credentials: [
            {
              badgeId: "badge-1",
              id: "badge-1",
              status: "issued",
            },
          ],
          participant: {
            email: "ana@example.com",
            id: "101",
          },
          participantAccessPassages: [],
          printJobs: [],
          sessionCheckins: [],
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/attendees/101`, {
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.attendee.email, "ana@example.com");
    assert.equal(body.data.credentials[0].badgeId, "badge-1");
  } finally {
    server.close();
  }
});

test("GET /api/events/:eventId/roles lists event members", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      listRoles: async (eventId) => {
        assert.equal(eventId, "manager-event");

        return [
          {
            email: "operator@example.com",
            name: "Operator",
            roles: ["pre_checkin_operator"],
            scope: {
              allowedAreaIds: [],
              allowedGateIds: [],
              allowedQueueIds: ["general"],
              allowedSessionIds: [],
            },
            uid: "operator-user",
          },
        ];
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/roles`, {
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data, [
      {
        email: "operator@example.com",
        name: "Operator",
        roles: ["pre_checkin_operator"],
        scope: {
          allowedAreaIds: [],
          allowedGateIds: [],
          allowedQueueIds: ["general"],
          allowedSessionIds: [],
        },
        uid: "operator-user",
      },
    ]);
  } finally {
    server.close();
  }
});

test("PUT /api/events/:eventId/roles/:uid upserts event member permissions", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      saveRole: async (eventId, uid, body, actor) => {
        assert.equal(eventId, "manager-event");
        assert.equal(uid, "operator-user");
        assert.equal(actor.uid, "manager-user");
        assert.deepEqual(body.roles, ["pre_checkin_operator", "gate_operator"]);
        assert.deepEqual(body.scope.allowedQueueIds, ["general"]);

        return {
          email: body.email,
          name: body.name,
          roles: body.roles,
          scope: body.scope,
          uid,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/roles/operator-user`, {
      body: JSON.stringify({
        email: "operator@example.com",
        name: "Operator",
        roles: ["pre_checkin_operator", "gate_operator"],
        scope: {
          allowedAreaIds: [],
          allowedGateIds: [],
          allowedQueueIds: ["general"],
          allowedSessionIds: [],
        },
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "content-type": "application/json",
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "PUT",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.uid, "operator-user");
    assert.deepEqual(body.data.roles, ["pre_checkin_operator", "gate_operator"]);
  } finally {
    server.close();
  }
});

test("GET /api/events/:eventId/users lists Firebase and Firestore users", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      listUsers: async (eventId) => {
        assert.equal(eventId, "manager-event");

        return [
          {
            createdAt: null,
            disabled: false,
            displayName: "Operator",
            email: "operator@example.com",
            source: "merged",
            uid: "operator-user",
          },
        ];
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/users`, {
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data[0].uid, "operator-user");
  } finally {
    server.close();
  }
});

test("POST /api/events/:eventId/users creates a Firebase Auth user", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      createUser: async (eventId, body, actor) => {
        assert.equal(eventId, "manager-event");
        assert.equal(body.email, "new@example.com");
        assert.equal(body.password, "secret123");
        assert.equal(actor.uid, "manager-user");

        return {
          createdAt: null,
          disabled: false,
          displayName: "New User",
          email: body.email,
          source: "merged",
          uid: "new-user",
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/users`, {
      body: JSON.stringify({
        displayName: "New User",
        email: "new@example.com",
        password: "secret123",
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "content-type": "application/json",
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.data.uid, "new-user");
  } finally {
    server.close();
  }
});

test("GET /api/events/:eventId/integrations/sendgrid/templates lists SendGrid templates", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      listSendGridTemplates: async (eventId) => {
        assert.equal(eventId, "manager-event");

        return [
          {
            id: "d-template",
            name: "Credential confirmation",
            updatedAt: null,
          },
        ];
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/integrations/sendgrid/templates`, {
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data[0].id, "d-template");
  } finally {
    server.close();
  }
});

test("DELETE /api/events/:eventId/terminals/:terminalId removes a terminal", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      deleteTerminal: async (eventId, terminalId, actor) => {
        assert.equal(eventId, "manager-event");
        assert.equal(terminalId, "printer-terminal-01");
        assert.equal(actor.uid, "manager-user");

        return {
          deleted: true,
          id: terminalId,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/terminals/printer-terminal-01`, {
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "DELETE",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.deleted, true);
    assert.equal(body.data.id, "printer-terminal-01");
  } finally {
    server.close();
  }
});

test("DELETE /api/events/:eventId/queues/:queueId removes a queue", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      deleteQueue: async (eventId, queueId, actor) => {
        assert.equal(eventId, "manager-event");
        assert.equal(queueId, "vip-queue");
        assert.equal(actor.uid, "manager-user");

        return {
          deleted: true,
          id: queueId,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/queues/vip-queue`, {
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "DELETE",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.deleted, true);
    assert.equal(body.data.id, "vip-queue");
  } finally {
    server.close();
  }
});

test("POST /api/events/:eventId/areas creates an access area", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      saveArea: async (eventId, areaId, body, actor) => {
        assert.equal(eventId, "manager-event");
        assert.equal(areaId, null);
        assert.equal(actor.uid, "manager-user");
        assert.deepEqual(body.registrationTypeIds, ["vip"]);

        return {
          id: "vip-lounge",
          name: body.name,
          registrationTypeIds: body.registrationTypeIds,
          status: body.status,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/areas`, {
      body: JSON.stringify({
        name: "VIP Lounge",
        registrationTypeIds: ["vip"],
        status: "active",
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "content-type": "application/json",
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.data.id, "vip-lounge");
  } finally {
    server.close();
  }
});

test("POST /api/events/:eventId/queues creates an event queue", async () => {
  const app = createApp({
    logger: null,
    allowTestHeaders: true,
    eventStore: {
      saveQueue: async (eventId, queueId, body, actor) => {
        assert.equal(eventId, "manager-event");
        assert.equal(queueId, null);
        assert.equal(actor.uid, "manager-user");
        assert.equal(body.name, "General");

        return {
          activeTerminalCount: 0,
          id: "general",
          name: body.name,
          status: body.status,
        };
      },
    },
  });
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/api/events/manager-event/queues`, {
      body: JSON.stringify({
        name: "General",
        status: "active",
      }),
      headers: {
        authorization: `Bearer ${fakeJwt({ sub: "manager-user" })}`,
        "content-type": "application/json",
        "x-test-global-roles": "event_manager",
        "x-test-user-id": "manager-user",
      },
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.data.id, "general");
  } finally {
    server.close();
  }
});
