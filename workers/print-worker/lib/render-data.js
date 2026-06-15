"use strict";

const {
  CredentialPayloadError,
  validateBadgePayloadSnapshot,
} = require("./credential-payload");

const ALLOWED_FIELD_SOURCES = new Set([
  "credentialQrPayload",
  "fullName",
  "firstName",
  "company",
  "jobTitle",
  "title",
]);

const ALLOWED_FIELD_TYPES = new Set(["text", "qr"]);

const DEFAULT_LAYOUT = {
  layoutId: "default-62x100",
  layoutVersion: 1,
  name: "Default 62x100",
  size: {
    widthMm: 62,
    heightMm: 100,
  },
  dpi: 300,
  fields: [
    {
      id: "qr",
      type: "qr",
      source: "credentialQrPayload",
      visible: true,
      xMm: 4,
      yMm: 4,
      widthMm: 24,
      heightMm: 24,
    },
    {
      id: "fullName",
      type: "text",
      source: "fullName",
      visible: true,
      xMm: 4,
      yMm: 34,
      widthMm: 54,
      heightMm: 16,
      fontSizePt: 18,
      fontWeight: 700,
      align: "center",
      maxLines: 2,
      overflow: "shrink",
    },
    {
      id: "company",
      type: "text",
      source: "company",
      visible: true,
      xMm: 6,
      yMm: 54,
      widthMm: 50,
      heightMm: 8,
      fontSizePt: 10,
      fontWeight: 600,
      align: "center",
      maxLines: 1,
      overflow: "ellipsis",
    },
    {
      id: "jobTitle",
      type: "text",
      source: "jobTitle",
      visible: true,
      xMm: 6,
      yMm: 64,
      widthMm: 50,
      heightMm: 8,
      fontSizePt: 9,
      fontWeight: 400,
      align: "center",
      maxLines: 1,
      overflow: "ellipsis",
    },
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

function assertPositiveNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new CredentialPayloadError(`${label} must be a positive number.`, { value });
  }
}

function assertNonNegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new CredentialPayloadError(`${label} must be a non-negative number.`, { value });
  }
}

function normalizeLayout(layout = DEFAULT_LAYOUT) {
  const normalized = clone(layout);

  if (!normalized.size || typeof normalized.size !== "object") {
    throw new CredentialPayloadError("Badge layout must include a size object.");
  }

  assertPositiveNumber(normalized.size.widthMm, "layout.size.widthMm");
  assertPositiveNumber(normalized.size.heightMm, "layout.size.heightMm");
  assertPositiveNumber(normalized.dpi, "layout.dpi");

  if (!Array.isArray(normalized.fields) || normalized.fields.length === 0) {
    throw new CredentialPayloadError("Badge layout must include at least one field.");
  }

  for (const field of normalized.fields) {
    if (!field || typeof field !== "object" || Array.isArray(field)) {
      throw new CredentialPayloadError("Badge layout fields must be objects.");
    }

    if (!field.id || typeof field.id !== "string") {
      throw new CredentialPayloadError("Badge layout field must include a string id.", {
        field,
      });
    }

    if (!ALLOWED_FIELD_TYPES.has(field.type)) {
      throw new CredentialPayloadError("Badge layout field type is not supported.", {
        fieldId: field.id,
        type: field.type,
      });
    }

    if (!ALLOWED_FIELD_SOURCES.has(field.source)) {
      throw new CredentialPayloadError("Badge layout field source is not supported.", {
        fieldId: field.id,
        source: field.source,
      });
    }

    assertNonNegativeNumber(field.xMm, `${field.id}.xMm`);
    assertNonNegativeNumber(field.yMm, `${field.id}.yMm`);
    assertPositiveNumber(field.widthMm, `${field.id}.widthMm`);
    assertPositiveNumber(field.heightMm, `${field.id}.heightMm`);

    if (field.xMm + field.widthMm > normalized.size.widthMm) {
      throw new CredentialPayloadError("Badge layout field exceeds badge width.", {
        fieldId: field.id,
      });
    }

    if (field.yMm + field.heightMm > normalized.size.heightMm) {
      throw new CredentialPayloadError("Badge layout field exceeds badge height.", {
        fieldId: field.id,
      });
    }

    if (field.type === "qr" && (field.widthMm < 18 || field.heightMm < 18)) {
      throw new CredentialPayloadError("QR fields must be at least 18mm square for scanning.", {
        fieldId: field.id,
      });
    }
  }

  return normalized;
}

function getSourceValue(snapshot, source, fallbackFirstName) {
  if (source === "credentialQrPayload") {
    return snapshot.credentialQrPayload;
  }

  if (source === "firstName") {
    return sanitizeText(snapshot.firstName) || fallbackFirstName;
  }

  if (source === "title") {
    return sanitizeText(snapshot.title || snapshot.jobTitle);
  }

  return sanitizeText(snapshot[source]);
}

function createLabelRenderData(printJob, options = {}) {
  if (!printJob || typeof printJob !== "object" || Array.isArray(printJob)) {
    throw new CredentialPayloadError("Print job must be an object.");
  }

  const snapshot = printJob.payloadSnapshot;
  const credential = validateBadgePayloadSnapshot(snapshot, printJob.credentialBadgeId);
  const layout = normalizeLayout(options.layout || DEFAULT_LAYOUT);
  const fullName = sanitizeText(snapshot.fullName);
  const fallbackFirstName = sanitizeText(snapshot.firstName) || fullName.split(" ")[0] || "";
  const company = sanitizeText(snapshot.company);
  const jobTitle = sanitizeText(snapshot.jobTitle || snapshot.title);

  const fields = layout.fields
    .filter((field) => field.visible !== false)
    .map((field) => ({
      id: field.id,
      type: field.type,
      source: field.source,
      value: getSourceValue(snapshot, field.source, fallbackFirstName),
      boxMm: {
        x: field.xMm,
        y: field.yMm,
        width: field.widthMm,
        height: field.heightMm,
      },
      text:
        field.type === "text"
          ? {
              fontSizePt: field.fontSizePt || 10,
              fontWeight: field.fontWeight || 400,
              align: field.align || "left",
              maxLines: field.maxLines || 1,
              overflow: field.overflow || "ellipsis",
            }
          : undefined,
    }));

  return {
    schema: "swoogo.printWorker.renderData.v1",
    generatedAt: new Date().toISOString(),
    job: {
      jobId: printJob.jobId,
      queueId: printJob.queueId,
      layoutId: printJob.layoutId || layout.layoutId,
      layoutVersion: printJob.layoutVersion || layout.layoutVersion,
      credentialBadgeId: printJob.credentialBadgeId,
    },
    credential,
    label: {
      fullName,
      firstName: fallbackFirstName,
      company,
      jobTitle,
      qrPayload: credential.raw,
    },
    layout: {
      layoutId: layout.layoutId,
      layoutVersion: layout.layoutVersion,
      name: layout.name,
      size: layout.size,
      dpi: layout.dpi,
    },
    fields,
  };
}

module.exports = {
  DEFAULT_LAYOUT,
  createLabelRenderData,
  normalizeLayout,
  sanitizeText,
};
