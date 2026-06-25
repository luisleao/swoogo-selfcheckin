const assert = require("node:assert/strict");
const test = require("node:test");
const { __test__ } = require("../src/api/event-store");

test("normalizes Swoogo registrant email from nested field arrays", () => {
  const result = __test__.normalizeSwoogoParticipants({
    registrants: [
      {
        id: 101,
        fields: [
          { field_name: "Email", value: "Ana.Silva@Example.COM" },
          { field_name: "First Name", value: "Ana" },
          { field_name: "Last Name", value: "Silva" },
          { field_name: "Company", value: "Acme Events" },
          { field_name: "Job Title", value: "Producer" },
        ],
        registration_type: {
          id: "vip",
          name: "VIP",
        },
      },
    ],
  });

  assert.equal(result.skippedCount, 0);
  assert.equal(result.participants.length, 1);
  assert.deepEqual(result.participants[0], {
    company: "Acme Events",
    email: "ana.silva@example.com",
    firstName: "Ana",
    fullName: "Ana Silva",
    id: "101",
    jobTitle: "Producer",
    lastName: "Silva",
    registrationStatus: "registered",
    registrationTypeId: "vip",
    registrationTypeName: "VIP",
  });
});

test("normalizes Swoogo registrant email from nested profile objects", () => {
  const result = __test__.normalizeSwoogoParticipants({
    data: {
      registrants: [
        {
          id: "102",
          profile: {
            contact_email: "Luis <luis@example.com>",
            first_name: "Luis",
            last_name: "Leao",
          },
        },
      ],
    },
  });

  assert.equal(result.participants[0].email, "luis@example.com");
  assert.equal(result.participants[0].fullName, "Luis Leao");
});

test("requests Swoogo participant fields that include email candidates", () => {
  const [firstAttempt] = __test__.swoogoParticipantRequestParams(
    {
      eventId: "8048",
    },
    2,
    250,
  );

  assert.equal(firstAttempt.event_id, "8048");
  assert.equal(firstAttempt.page, 2);
  assert.equal(firstAttempt["per-page"], 250);
  assert.match(firstAttempt.fields, /email/);
  assert.match(firstAttempt.fields, /email_address/);
  assert.match(firstAttempt.include, /fields/);
});

test("normalizes Swoogo registration types from nested registrant fields", () => {
  const result = __test__.normalizeSwoogoRegistrationTypesFromRegistrants({
    registrants: [
      {
        id: "101",
        fields: [
          { field_name: "Registration Type ID", value: "vip" },
          { field_name: "Registration Type Name", value: "VIP Guest" },
        ],
      },
      {
        id: "102",
        registration_type: {
          id: "speaker",
          name: "Speaker",
        },
      },
    ],
  });

  assert.deepEqual(result, [
    {
      id: "speaker",
      name: "Speaker",
    },
    {
      id: "vip",
      name: "VIP Guest",
    },
  ]);
});

test("normalizes Swoogo registration type maps", () => {
  const result = __test__.normalizeSwoogoRegistrationTypes({
    registrationTypes: {
      attendee: "General Attendee",
      vip: {
        name: "VIP",
      },
    },
  });

  assert.deepEqual(result, [
    {
      id: "attendee",
      name: "General Attendee",
    },
    {
      id: "vip",
      name: "VIP",
    },
  ]);
});

test("requests Swoogo registrants with registration type discovery fields", () => {
  const attempts = __test__.swoogoRegistrationTypeDiscoveryParams({
    eventId: "8048",
  });

  assert.ok(attempts.length >= 4);
  assert.match(attempts[0].fields, /registration_type_id/);
  assert.match(attempts[0].include, /fields/);
  assert.ok(attempts.some((attempt) => Object.prototype.hasOwnProperty.call(attempt, "per_page")));
});
