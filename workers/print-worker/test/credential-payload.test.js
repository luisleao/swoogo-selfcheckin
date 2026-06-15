"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CredentialPayloadError,
  validateBadgePayloadSnapshot,
  validateCredentialQrPayload,
} = require("../lib/credential-payload");

test("validates BADGEID;epochSeconds;SWOOGOID payloads", () => {
  const parsed = validateCredentialQrPayload("a7Kx9Qm2Pz4R8tY6uV3n;1781269200;26361060");

  assert.deepEqual(parsed, {
    badgeId: "a7Kx9Qm2Pz4R8tY6uV3n",
    epochSeconds: 1781269200,
    raw: "a7Kx9Qm2Pz4R8tY6uV3n;1781269200;26361060",
    swoogoRegistrantId: "26361060",
  });
});

test("rejects malformed credential payloads", () => {
  assert.throws(
    () => validateCredentialQrPayload("a7Kx9Qm2Pz4R8tY6uV3n;not-time;26361060"),
    CredentialPayloadError
  );
  assert.throws(
    () => validateCredentialQrPayload("a7Kx9Qm2Pz4R8tY6uV3n;1781269200"),
    CredentialPayloadError
  );
  assert.throws(
    () => validateCredentialQrPayload(" a7Kx9Qm2Pz4R8tY6uV3n;1781269200;26361060"),
    CredentialPayloadError
  );
});

test("validates print job payload snapshot against credentialBadgeId", () => {
  assert.throws(
    () =>
      validateBadgePayloadSnapshot(
        {
          credentialQrPayload: "zzzz9Qm2Pz4R8tY6uV3n;1781269200;26361060",
        },
        "a7Kx9Qm2Pz4R8tY6uV3n"
      ),
    CredentialPayloadError
  );
});
