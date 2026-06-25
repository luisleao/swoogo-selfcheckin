const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCredentialQrPayload,
  buildDryRunSummary,
  buildSeedDataset,
  parseArgs,
} = require("../scripts/setup-firestore");

test("parseArgs accepts setup CLI flags and environment defaults", () => {
  const options = parseArgs(
    [
      "--dry-run",
      "--event-slug",
      "Twilio Assemble Sao Paulo",
      "--admin-email=signal@example.com",
      "--swoogo-event-id",
      "8048",
    ],
    {
      SETUP_ADMIN_PASSWORD: "secret-password",
      SETUP_EVENT_NAME: "Env Event Name",
    },
  );

  assert.equal(options.dryRun, true);
  assert.equal(options.eventSlug, "twilio-assemble-sao-paulo");
  assert.equal(options.eventName, "Env Event Name");
  assert.equal(options.adminEmail, "signal@example.com");
  assert.equal(options.adminPassword, "secret-password");
  assert.equal(options.swoogoEventId, "8048");
});

test("buildSeedDataset creates the expected event-scoped setup records", () => {
  const dataset = buildSeedDataset({
    adminEmail: "admin@example.com",
    adminName: "Admin User",
    adminUid: "admin-uid",
    eventName: "Demo Event",
    eventSlug: "demo-event",
  });
  const summary = buildDryRunSummary(dataset);

  assert.equal(dataset.event.eventId, "demo-event");
  assert.equal(dataset.event.registration, true);
  assert.equal(dataset.event.defaults.queueId, "general");
  assert.equal(dataset.event.defaults.badgeLayoutId, "default-62x100");
  assert.equal(dataset.registrationTypes.length, 4);
  assert.ok(dataset.queues.some((queue) => queue.queueId === "vip" && queue.registrationTypeIds.includes("staff")));
  assert.ok(dataset.areas.some((area) => area.areaId === "vip-lounge" && area.registrationTypeIds.includes("vip")));
  assert.ok(dataset.sessions.some((session) => session.areaId === "auditorium-1"));
  assert.ok(dataset.participants.every((participant) => participant.email.includes("@")));
  assert.equal(summary.databaseId, "attendee-registry");
  assert.equal(summary.writes.participants, dataset.participants.length);
});

test("buildCredentialQrPayload uses badge id, epoch seconds, and registrant id", () => {
  const issuedAt = new Date("2026-06-25T12:00:45.000Z");

  assert.equal(
    buildCredentialQrPayload("badge-auto-id", issuedAt, "1001"),
    "badge-auto-id;1782388845;1001",
  );
});
