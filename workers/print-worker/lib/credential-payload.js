"use strict";

class CredentialPayloadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CredentialPayloadError";
    this.code = "invalid_credential_payload";
    this.details = details;
  }
}

const BADGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const DIGITS_PATTERN = /^[0-9]+$/;
const MIN_REASONABLE_EPOCH_SECONDS = 946684800; // 2000-01-01T00:00:00Z
const MAX_REASONABLE_EPOCH_SECONDS = 4102444800; // 2100-01-01T00:00:00Z

function validateCredentialQrPayload(payload) {
  if (typeof payload !== "string") {
    throw new CredentialPayloadError("Credential QR payload must be a string.", {
      receivedType: typeof payload,
    });
  }

  if (payload.trim() !== payload || payload.length === 0) {
    throw new CredentialPayloadError("Credential QR payload must not be empty or padded.", {
      payload,
    });
  }

  const parts = payload.split(";");
  if (parts.length !== 3) {
    throw new CredentialPayloadError(
      "Credential QR payload must use BADGEID;epochSeconds;SWOOGOID.",
      { partCount: parts.length }
    );
  }

  const [badgeId, epochSecondsRaw, swoogoRegistrantId] = parts;

  if (!BADGE_ID_PATTERN.test(badgeId)) {
    throw new CredentialPayloadError(
      "BADGEID must look like a Firestore-generated credential document ID.",
      { badgeId }
    );
  }

  if (!DIGITS_PATTERN.test(epochSecondsRaw)) {
    throw new CredentialPayloadError("epochSeconds must be an integer string.", {
      epochSeconds: epochSecondsRaw,
    });
  }

  const epochSeconds = Number(epochSecondsRaw);
  if (
    !Number.isSafeInteger(epochSeconds) ||
    epochSeconds < MIN_REASONABLE_EPOCH_SECONDS ||
    epochSeconds > MAX_REASONABLE_EPOCH_SECONDS
  ) {
    throw new CredentialPayloadError("epochSeconds is outside the supported event range.", {
      epochSeconds,
    });
  }

  if (!DIGITS_PATTERN.test(swoogoRegistrantId)) {
    throw new CredentialPayloadError("SWOOGOID must be a numeric registrant ID.", {
      swoogoRegistrantId,
    });
  }

  return {
    badgeId,
    epochSeconds,
    swoogoRegistrantId,
    raw: payload,
  };
}

function validateBadgePayloadSnapshot(payloadSnapshot, expectedBadgeId) {
  if (!payloadSnapshot || typeof payloadSnapshot !== "object" || Array.isArray(payloadSnapshot)) {
    throw new CredentialPayloadError("Print job payloadSnapshot must be an object.");
  }

  const parsed = validateCredentialQrPayload(payloadSnapshot.credentialQrPayload);
  if (expectedBadgeId && parsed.badgeId !== expectedBadgeId) {
    throw new CredentialPayloadError(
      "Credential QR payload BADGEID does not match the print job credentialBadgeId.",
      {
        expectedBadgeId,
        payloadBadgeId: parsed.badgeId,
      }
    );
  }

  return parsed;
}

module.exports = {
  CredentialPayloadError,
  validateBadgePayloadSnapshot,
  validateCredentialQrPayload,
};
