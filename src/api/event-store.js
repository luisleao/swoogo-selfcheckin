const { FieldValue } = require("firebase-admin/firestore");
const { getFirebaseAuth, getFirestoreDb } = require("./firebase-admin");
const { conflict, notFound } = require("./errors");

const serverTimestamp = () => FieldValue.serverTimestamp();
const deleteField = () => FieldValue.delete();

function isSuperAdmin(actor) {
  return Array.isArray(actor?.globalRoles) && actor.globalRoles.includes("super_admin");
}

function canManageCredentialingEvents(actor) {
  return Array.isArray(actor?.globalRoles)
    && (actor.globalRoles.includes("super_admin") || actor.globalRoles.includes("event_manager"));
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSlug(value, fallback = "") {
  return normalizeString(value, fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeList(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
    : [];
}

function normalizeScopeMode(value, fallback = "all") {
  return ["all", "none", "selected"].includes(value) ? value : fallback;
}

function dateValue(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return typeof value === "string" ? value : null;
}

function firestoreValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => firestoreValue(entry));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, firestoreValue(entry)]),
    );
  }

  return value;
}

function membershipResponse(eventId, membership) {
  if (!membership) {
    return null;
  }

  return {
    active: membership.status !== "inactive" && membership.active !== false,
    eventId,
    roles: normalizeList(membership.roles),
    scope: {
      allowedAreaIds: normalizeList(membership.allowedAreaIds || membership.allowedAreas),
      allowedGateIds: normalizeList(membership.allowedGateIds || membership.allowedGates),
      allowedQueueIds: normalizeList(membership.allowedQueueIds || membership.allowedQueues),
      allowedSessionIds: normalizeList(membership.allowedSessionIds || membership.allowedSessions),
    },
  };
}

function superAdminMembership(eventId) {
  return {
    active: true,
    eventId,
    roles: [
      "event_admin",
      "pre_checkin_operator",
      "print_operator",
      "pickup_operator",
      "session_operator",
      "gate_operator",
      "dashboard_viewer",
      "layout_editor",
    ],
    scope: {
      allowedAreaIds: [],
      allowedGateIds: [],
      allowedQueueIds: [],
      allowedSessionIds: [],
    },
  };
}

function eventManagerMembership(eventId) {
  return {
    active: true,
    eventId,
    roles: [
      "event_admin",
      "event_manager",
      "pre_checkin_operator",
      "print_operator",
      "pickup_operator",
      "session_operator",
      "gate_operator",
      "dashboard_viewer",
      "layout_editor",
    ],
    scope: {
      allowedAreaIds: [],
      allowedGateIds: [],
      allowedQueueIds: [],
      allowedSessionIds: [],
    },
  };
}

function managementMembership(eventId, actor) {
  return isSuperAdmin(actor) ? superAdminMembership(eventId) : eventManagerMembership(eventId);
}

function mergeMemberships(eventId, primary, secondary) {
  if (!primary) {
    return secondary;
  }

  if (!secondary) {
    return primary;
  }

  return {
    ...primary,
    active: primary.active !== false && secondary.active !== false,
    eventId,
    roles: Array.from(new Set([...normalizeList(primary.roles), ...normalizeList(secondary.roles)])),
    scope: {
      allowedAreaIds: Array.from(new Set([
        ...normalizeList(primary.scope?.allowedAreaIds || primary.allowedAreaIds),
        ...normalizeList(secondary.scope?.allowedAreaIds || secondary.allowedAreaIds),
      ])),
      allowedGateIds: Array.from(new Set([
        ...normalizeList(primary.scope?.allowedGateIds || primary.allowedGateIds),
        ...normalizeList(secondary.scope?.allowedGateIds || secondary.allowedGateIds),
      ])),
      allowedQueueIds: Array.from(new Set([
        ...normalizeList(primary.scope?.allowedQueueIds || primary.allowedQueueIds),
        ...normalizeList(secondary.scope?.allowedQueueIds || secondary.allowedQueueIds),
      ])),
      allowedSessionIds: Array.from(new Set([
        ...normalizeList(primary.scope?.allowedSessionIds || primary.allowedSessionIds),
        ...normalizeList(secondary.scope?.allowedSessionIds || secondary.allowedSessionIds),
      ])),
    },
  };
}

async function membershipForEventSnapshot(eventSnapshot, actor) {
  const memberSnapshot = await eventSnapshot.ref.collection("members").doc(actor.uid).get();

  return memberSnapshot.exists
    ? membershipResponse(eventSnapshot.id, memberSnapshot.data())
    : null;
}

function eventResponse(snapshot, membership = null) {
  const data = snapshot.data() || {};
  const eventId = data.eventId || snapshot.id;
  const defaults = data.defaults && typeof data.defaults === "object" ? data.defaults : {};
  const swoogo = data.swoogo && typeof data.swoogo === "object" ? data.swoogo : {};

  return {
    defaultQueueId: normalizeOptionalString(defaults.queueId),
    id: eventId,
    name: normalizeString(data.name, eventId),
    registration: data.registration === true,
    status: normalizeString(data.status, "draft"),
    swoogoBaseUrl: normalizeString(swoogo.baseUrl, "https://api.swoogo.com"),
    swoogoEventId: normalizeOptionalString(swoogo.eventId),
    timezone: normalizeString(data.timezone, "America/Sao_Paulo"),
    ...(membership ? { membership } : {}),
  };
}

function defaultConnectionResult(message = "Not tested") {
  return {
    checkedAt: null,
    message,
    status: "untested",
  };
}

function connectionResult(status, message) {
  return {
    checkedAt: new Date().toISOString(),
    message,
    status,
  };
}

function stringish(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }

  return "";
}

function getSwoogoIntegration(eventData = {}) {
  return eventData.swoogo && typeof eventData.swoogo === "object" ? eventData.swoogo : {};
}

function getSwoogoClientConfig(eventData = {}) {
  const swoogo = getSwoogoIntegration(eventData);
  const credentials = swoogo.credentials && typeof swoogo.credentials === "object" ? swoogo.credentials : {};
  const consumerKey = normalizeOptionalString(credentials.consumerKey || credentials.clientId || credentials.apiKey);
  const consumerSecret = normalizeOptionalString(credentials.consumerSecret || credentials.clientSecret);
  const eventId = normalizeOptionalString(swoogo.eventId);

  return {
    baseUrl: normalizeString(swoogo.baseUrl, "https://api.swoogo.com"),
    consumerKey,
    consumerSecret,
    eventId,
    ready: Boolean(eventId && consumerKey && consumerSecret),
  };
}

function getSendGridIntegration(eventData = {}) {
  return eventData.sendgrid && typeof eventData.sendgrid === "object"
    ? eventData.sendgrid
    : eventData.sendGrid && typeof eventData.sendGrid === "object"
      ? eventData.sendGrid
      : {};
}

function getSendGridClientConfig(eventData = {}, body = {}) {
  const sendgrid = getSendGridIntegration(eventData);
  const credentials = sendgrid.credentials && typeof sendgrid.credentials === "object" ? sendgrid.credentials : {};
  const apiKey = normalizeOptionalString(body.apiKey || credentials.apiKey || sendgrid.apiKey);

  return {
    apiKey,
    fromEmail: normalizeString(body.fromEmail, sendgrid.fromEmail || ""),
    fromName: normalizeString(body.fromName, sendgrid.fromName || ""),
    replyToEmail: normalizeString(body.replyToEmail, sendgrid.replyToEmail || ""),
    ready: Boolean(apiKey),
  };
}

function buildSwoogoApiUrl(baseUrl, resourcePath, searchParams = {}) {
  const base = normalizeString(baseUrl, "https://api.swoogo.com").replace(/\/+$/, "");
  let path = resourcePath.replace(/^\/+/, "");

  if (base.endsWith("/api/v1") && path.startsWith("api/v1/")) {
    path = path.slice("api/v1/".length);
  }

  const url = new URL(`${base}/${path}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== null && value !== undefined && String(value).trim()) {
      url.searchParams.set(key, String(value).trim());
    }
  }

  return url.toString();
}

async function requestSendGridJson(path, apiKey, options = {}) {
  if (!apiKey) {
    throw conflict("SENDGRID_API_KEY_MISSING", "Save the SendGrid API key before using SendGrid.");
  }

  if (typeof fetch !== "function") {
    throw conflict("SENDGRID_FETCH_UNAVAILABLE", "SendGrid integration requires a runtime with fetch support.");
  }

  const url = `https://api.sendgrid.com/v3/${path.replace(/^\/+/, "")}`;
  const { body, response } = await fetchJsonWithTimeout(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
    method: options.method || "GET",
  });

  if (!response.ok) {
    throw conflict("SENDGRID_API_REQUEST_FAILED", `SendGrid returned HTTP ${response.status}.`, {
      details: { status: response.status },
    });
  }

  return body;
}

async function fetchJsonWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs || 10000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    let body = null;

    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return { body, response };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestSwoogoAccessToken(config) {
  if (typeof fetch !== "function") {
    throw conflict("SWOOGO_FETCH_UNAVAILABLE", "Swoogo sync requires a runtime with fetch support.");
  }

  const credentials = `${encodeURIComponent(config.consumerKey)}:${encodeURIComponent(config.consumerSecret)}`;
  let body;
  let response;

  try {
    ({ body, response } = await fetchJsonWithTimeout(
      buildSwoogoApiUrl(config.baseUrl, "api/v1/oauth2/token"),
      {
        body: "grant_type=client_credentials",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        method: "POST",
      },
    ));
  } catch (error) {
    throw conflict("SWOOGO_AUTH_FAILED", "Unable to authenticate with Swoogo. Check the event API key and secret.", {
      details: { cause: error.message },
    });
  }

  if (!response.ok) {
    throw conflict("SWOOGO_AUTH_FAILED", "Unable to authenticate with Swoogo. Check the event API key and secret.", {
      details: { status: response.status },
    });
  }

  const accessToken = stringish(body?.access_token, body?.accessToken, body?.token);
  if (!accessToken) {
    throw conflict("SWOOGO_AUTH_FAILED", "Swoogo did not return an access token.");
  }

  return accessToken.toLowerCase().startsWith("bearer ") ? accessToken : `Bearer ${accessToken}`;
}

function extractSwoogoList(body) {
  const candidates = [
    body,
    body?.data,
    body?.items,
    body?.objects,
    body?.results,
    body?.rows,
    body?.types,
    body?.registrationTypes,
    body?.registration_types,
    body?.registrants,
    body?.registrantTypes,
    body?.registrant_types,
    body?.data?.items,
    body?.data?.objects,
    body?.data?.results,
    body?.data?.rows,
    body?.data?.types,
    body?.data?.registrationTypes,
    body?.data?.registration_types,
    body?.data?.registrants,
    body?.data?.registrantTypes,
    body?.data?.registrant_types,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const mapCandidates = [
    body?.registrationTypes,
    body?.registration_types,
    body?.registrantTypes,
    body?.registrant_types,
    body?.types,
    body?.data?.registrationTypes,
    body?.data?.registration_types,
    body?.data?.registrantTypes,
    body?.data?.registrant_types,
    body?.data?.types,
  ];

  for (const candidate of mapCandidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return Object.entries(candidate).map(([id, value]) => (
        value && typeof value === "object"
          ? { id, ...value }
          : { id, name: value }
      ));
    }
  }

  return [];
}

function normalizeSwoogoRegistrationType(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const id = stringish(
    item.id,
    item.registrationType?.id,
    item.registration_type?.id,
    item.registrantType?.id,
    item.registrant_type?.id,
    item.registrationTypeId,
    item.registration_type_id,
    item.registrantTypeId,
    item.registrant_type_id,
    item.typeId,
    item.type_id,
    item.value,
    extractSwoogoField(item, REGISTRATION_TYPE_ID_KEYS),
  );

  if (!id) {
    return null;
  }

  return {
    id,
    name: stringish(
      item.name,
      item.title,
      item.label,
      item.description,
      item.registrationType?.name,
      item.registration_type?.name,
      item.registrantType?.name,
      item.registrant_type?.name,
      extractSwoogoField(item, REGISTRATION_TYPE_NAME_KEYS),
      id,
    ),
  };
}

function normalizeSwoogoRegistrationTypes(body) {
  const byId = new Map();

  for (const item of extractSwoogoList(body)) {
    const registrationType = normalizeSwoogoRegistrationType(item);
    if (registrationType) {
      byId.set(registrationType.id, registrationType);
    }
  }

  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeSwoogoRegistrationTypeFromRegistrant(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const nested = item.registrationType && typeof item.registrationType === "object"
    ? item.registrationType
    : item.registration_type && typeof item.registration_type === "object"
      ? item.registration_type
      : item.registrantType && typeof item.registrantType === "object"
        ? item.registrantType
        : item.registrant_type && typeof item.registrant_type === "object"
          ? item.registrant_type
          : null;
  const nestedText = !nested
    ? stringish(item.registrationType, item.registration_type, item.registrantType, item.registrant_type)
    : "";
  const semanticId = extractSwoogoField(item, REGISTRATION_TYPE_ID_KEYS);
  const semanticName = extractSwoogoField(item, REGISTRATION_TYPE_NAME_KEYS);
  const id = stringish(
    nested?.id,
    nested?.value,
    nested?.key,
    nested?.registrationTypeId,
    nested?.registration_type_id,
    nested?.registrantTypeId,
    nested?.registrant_type_id,
    item.registrationTypeId,
    item.registration_type_id,
    item.registrantTypeId,
    item.registrant_type_id,
    item.regTypeId,
    item.reg_type_id,
    semanticId,
    nestedText,
  );

  if (!id) {
    return null;
  }

  return {
    id,
    name: stringish(
      nested?.name,
      nested?.title,
      nested?.label,
      item.registrationTypeName,
      item.registration_type_name,
      item.registrantTypeName,
      item.registrant_type_name,
      item.regTypeName,
      item.reg_type_name,
      nested?.displayValue,
      nested?.display_value,
      nested?.description,
      semanticName,
      nestedText,
      id,
    ),
  };
}

function normalizeSwoogoRegistrationTypesFromRegistrants(body) {
  const byId = new Map();

  for (const item of extractSwoogoList(body)) {
    const registrationType = normalizeSwoogoRegistrationTypeFromRegistrant(item);
    if (registrationType) {
      byId.set(registrationType.id, registrationType);
    }
  }

  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeEmail(value) {
  return normalizeString(value, "").toLowerCase();
}

function parsePositiveInteger(value, fallback, max) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SWOOGO_FIELD_CONTAINERS = [
  "answers",
  "attendee",
  "contact",
  "customFields",
  "custom_fields",
  "data",
  "fields",
  "formData",
  "form_data",
  "profile",
  "registrant",
  "responses",
];
const SWOOGO_FIELD_LABEL_KEYS = [
  "field",
  "fieldId",
  "field_id",
  "fieldName",
  "field_name",
  "id",
  "key",
  "label",
  "name",
  "question",
  "questionId",
  "question_id",
  "questionName",
  "question_name",
  "slug",
  "title",
];
const SWOOGO_FIELD_VALUE_KEYS = [
  "answer",
  "answers",
  "display",
  "displayValue",
  "display_value",
  "text",
  "value",
  "values",
  "id",
  "label",
  "name",
];
const EMAIL_KEYS = [
  "attendeeEmail",
  "attendee_email",
  "contactEmail",
  "contact_email",
  "email",
  "emailAddress",
  "email_address",
  "primaryEmail",
  "primary_email",
  "registrantEmail",
  "registrant_email",
];
const FIRST_NAME_KEYS = ["firstName", "first_name", "fname", "givenName", "given_name"];
const LAST_NAME_KEYS = ["familyName", "family_name", "lastName", "last_name", "lname", "surname"];
const FULL_NAME_KEYS = ["fullName", "full_name", "name"];
const COMPANY_KEYS = ["accountName", "account_name", "company", "organization", "organisation"];
const JOB_TITLE_KEYS = ["jobTitle", "job_title", "position", "title"];
const REGISTRATION_TYPE_ID_KEYS = [
  "registrationType",
  "registration_type",
  "registrationTypeId",
  "registration_type_id",
  "registrantType",
  "registrant_type",
  "registrantTypeId",
  "registrant_type_id",
  "regType",
  "reg_type",
  "regTypeId",
  "reg_type_id",
  "type",
  "typeId",
  "type_id",
];
const REGISTRATION_TYPE_NAME_KEYS = [
  "registrationTypeName",
  "registration_type_name",
  "registrantTypeName",
  "registrant_type_name",
  "regTypeName",
  "reg_type_name",
  "typeName",
  "type_name",
];
const SWOOGO_PARTICIPANT_FIELDS = [
  "id",
  "email",
  "emailAddress",
  "email_address",
  "primaryEmail",
  "primary_email",
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "fullName",
  "full_name",
  "name",
  "company",
  "organization",
  "jobTitle",
  "job_title",
  "title",
  "registration_type",
  "registration_type_id",
  "registration_type_name",
  "registrationType",
  "registrationTypeId",
  "registrationTypeName",
  "fields",
  "answers",
  "custom_fields",
  "profile",
  "contact",
];

function normalizeLookupKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function asLookupSet(keys) {
  return new Set(keys.map((key) => normalizeLookupKey(key)).filter(Boolean));
}

function valueFromPrimitive(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

function valueFromFieldValue(value) {
  const primitive = valueFromPrimitive(value);

  if (primitive) {
    return primitive;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => valueFromFieldValue(entry)).find(Boolean) || "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  for (const key of SWOOGO_FIELD_VALUE_KEYS) {
    const nested = valueFromFieldValue(value[key]);

    if (nested) {
      return nested;
    }
  }

  return "";
}

function valueFromSemanticKeys(source, lookupKeys) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return "";
  }

  for (const [key, value] of Object.entries(source)) {
    if (lookupKeys.has(normalizeLookupKey(key))) {
      const directValue = valueFromFieldValue(value);

      if (directValue) {
        return directValue;
      }
    }
  }

  return "";
}

function fieldLabelMatches(field, lookupKeys) {
  if (!field || typeof field !== "object" || Array.isArray(field)) {
    return false;
  }

  return SWOOGO_FIELD_LABEL_KEYS.some((key) => lookupKeys.has(normalizeLookupKey(field[key])));
}

function valueFromFieldCollection(collection, lookupKeys) {
  if (!collection) {
    return "";
  }

  if (Array.isArray(collection)) {
    for (const field of collection) {
      if (fieldLabelMatches(field, lookupKeys)) {
        const value = valueFromFieldValue(field);

        if (value) {
          return value;
        }
      }

      const directValue = valueFromSemanticKeys(field, lookupKeys);

      if (directValue) {
        return directValue;
      }
    }

    return "";
  }

  if (typeof collection === "object") {
    return valueFromSemanticKeys(collection, lookupKeys);
  }

  return "";
}

function extractSwoogoField(item, keys) {
  const lookupKeys = asLookupSet(keys);
  const directValue = valueFromSemanticKeys(item, lookupKeys);

  if (directValue) {
    return directValue;
  }

  for (const containerKey of SWOOGO_FIELD_CONTAINERS) {
    const value = valueFromFieldCollection(item?.[containerKey], lookupKeys);

    if (value) {
      return value;
    }
  }

  return "";
}

function extractEmail(value) {
  const direct = valueFromFieldValue(value);
  const match = direct.match(EMAIL_PATTERN);

  return match ? match[0].toLowerCase() : "";
}

function extractSwoogoEmail(item) {
  const candidates = [
    extractSwoogoField(item, EMAIL_KEYS),
    item?.email,
    item?.emailAddress,
    item?.email_address,
    item?.primaryEmail,
    item?.primary_email,
  ];

  for (const containerKey of SWOOGO_FIELD_CONTAINERS) {
    const container = item?.[containerKey];

    if (Array.isArray(container)) {
      for (const field of container) {
        if (fieldLabelMatches(field, asLookupSet(EMAIL_KEYS))) {
          candidates.push(valueFromFieldValue(field));
        }
      }
    }
  }

  return candidates.map((candidate) => extractEmail(candidate)).find(Boolean) || "";
}

function normalizeSwoogoRegistrant(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const id = stringish(
    item.id,
    item.registrantId,
    item.registrant_id,
    item.registrationId,
    item.registration_id,
    item.swoogoRegistrantId,
  );

  if (!id) {
    return null;
  }

  const email = extractSwoogoEmail(item);
  const firstName = extractSwoogoField(item, FIRST_NAME_KEYS);
  const lastName = extractSwoogoField(item, LAST_NAME_KEYS);
  const fullName = stringish(
    extractSwoogoField(item, FULL_NAME_KEYS),
    [firstName, lastName].filter(Boolean).join(" "),
    email,
    id,
  );
  const company = extractSwoogoField(item, COMPANY_KEYS);
  const jobTitle = extractSwoogoField(item, JOB_TITLE_KEYS);
  const registrationType = normalizeSwoogoRegistrationTypeFromRegistrant(item);

  return {
    company,
    email,
    firstName,
    fullName,
    id,
    jobTitle,
    lastName,
    registrationStatus: stringish(item.status, item.registrationStatus, item.registration_status, "registered"),
    registrationTypeId: registrationType?.id || "",
    registrationTypeName: registrationType?.name || "",
  };
}

function normalizeSwoogoParticipants(body) {
  const participantsById = new Map();
  let skippedCount = 0;

  for (const item of extractSwoogoList(body)) {
    const participant = normalizeSwoogoRegistrant(item);

    if (!participant) {
      skippedCount += 1;
      continue;
    }

    participantsById.set(participant.id, participant);
  }

  return {
    participants: Array.from(participantsById.values()),
    skippedCount,
  };
}

function swoogoParticipantRequestParams(config, page, perPage) {
  const base = {
    event_id: config.eventId,
    page,
    "per-page": perPage,
  };

  return [
    {
      ...base,
      expand: "fields,answers,custom_fields,profile,contact",
      fields: SWOOGO_PARTICIPANT_FIELDS.join(","),
      include: "fields,answers,custom_fields,profile,contact",
    },
    {
      ...base,
      fields: SWOOGO_PARTICIPANT_FIELDS.join(","),
    },
    {
      ...base,
      expand: "fields,answers,custom_fields,profile,contact",
      include: "fields,answers,custom_fields,profile,contact",
    },
    base,
  ];
}

function participantImportScore(normalized) {
  const emailCount = normalized.participants.filter((participant) => Boolean(participant.email)).length;

  return emailCount * 10000 + normalized.participants.length;
}

async function fetchSwoogoParticipantPage(config, authorization, page, perPage) {
  let best = null;
  let lastFailure = null;

  for (const params of swoogoParticipantRequestParams(config, page, perPage)) {
    let body;
    let response;

    try {
      ({ body, response } = await fetchJsonWithTimeout(
        buildSwoogoApiUrl(config.baseUrl, "api/v1/registrants", params),
        {
          headers: {
            Accept: "application/json",
            Authorization: authorization,
          },
          method: "GET",
        },
      ));
    } catch (error) {
      lastFailure = { cause: error.message };
      continue;
    }

    if (!response.ok) {
      lastFailure = { status: response.status };
      continue;
    }

    const normalized = normalizeSwoogoParticipants(body);
    const candidate = {
      body,
      normalized,
      rawCount: extractSwoogoList(body).length,
      score: participantImportScore(normalized),
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }

    if (
      candidate.normalized.participants.length > 0
      && candidate.normalized.participants.every((participant) => Boolean(participant.email))
    ) {
      return candidate;
    }
  }

  if (best) {
    return best;
  }

  throw conflict(
    "SWOOGO_PARTICIPANT_IMPORT_FAILED",
    "Unable to load Swoogo registrants. Check the Swoogo event ID and credentials.",
    { details: lastFailure },
  );
}

function hasNextSwoogoPage(body, page, perPage, rawCount) {
  const nextLink = body?.links?.next
    || body?._links?.next?.href
    || body?.meta?.links?.next
    || body?.pagination?.next
    || body?.next
    || body?.nextPageUrl
    || body?.next_page_url;

  if (nextLink) {
    return true;
  }

  const pageCount = Number(
    body?.pageCount
      || body?.page_count
      || body?.meta?.pageCount
      || body?.meta?.page_count
      || body?.pagination?.pageCount
      || body?.pagination?.page_count,
  );

  if (Number.isFinite(pageCount) && pageCount > 0) {
    return page < pageCount;
  }

  const total = Number(body?.total || body?.totalCount || body?.total_count || body?.meta?.total || body?.pagination?.total);

  if (Number.isFinite(total) && total > 0) {
    return page * perPage < total;
  }

  return rawCount >= perPage;
}

async function fetchSwoogoParticipants(config, options = {}) {
  const authorization = await requestSwoogoAccessToken(config);
  const perPage = parsePositiveInteger(options.perPage, 1000, 1000);
  const maxPages = parsePositiveInteger(options.maxPages, 100, 500);
  const participantsById = new Map();
  let skippedCount = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const { body, normalized, rawCount } = await fetchSwoogoParticipantPage(
      config,
      authorization,
      page,
      perPage,
    );

    skippedCount += normalized.skippedCount;

    for (const participant of normalized.participants) {
      participantsById.set(participant.id, participant);
    }

    if (!hasNextSwoogoPage(body, page, perPage, rawCount)) {
      break;
    }
  }

  return {
    participants: Array.from(participantsById.values()),
    skippedCount,
  };
}

function swoogoRegistrationTypeDiscoveryParams(config) {
  const participantAttempts = swoogoParticipantRequestParams(config, 1, 1000);
  const explicitFieldAttempt = {
    event_id: config.eventId,
    fields: [
      "id",
      "registration_type",
      "registration_type_id",
      "registration_type_name",
      "registrationType",
      "registrationTypeId",
      "registrationTypeName",
      "registrant_type",
      "registrant_type_id",
      "registrant_type_name",
      "regType",
      "regTypeId",
      "regTypeName",
      "fields",
      "answers",
      "custom_fields",
    ].join(","),
    include: "fields,answers,custom_fields",
    page: 1,
    "per-page": "1000",
  };

  return [
    explicitFieldAttempt,
    ...participantAttempts,
    ...participantAttempts.map((params) => {
      const { "per-page": perPage, ...rest } = params;

      return {
        ...rest,
        per_page: perPage,
      };
    }),
    {
      event_id: config.eventId,
      page: 1,
      "per-page": "1000",
    },
    {
      event_id: config.eventId,
      page: 1,
      per_page: "1000",
    },
  ];
}

async function fetchSwoogoRegistrationTypesFromRegistrants(config, authorization) {
  const attempts = swoogoRegistrationTypeDiscoveryParams(config);
  let lastFailure = null;
  let foundEmptyRegistrantResponse = false;

  for (const params of attempts) {
    let body;
    let response;

    try {
      ({ body, response } = await fetchJsonWithTimeout(
        buildSwoogoApiUrl(config.baseUrl, "api/v1/registrants", params),
        {
          headers: {
            Accept: "application/json",
            Authorization: authorization,
          },
          method: "GET",
        },
      ));
    } catch (error) {
      throw conflict(
        "SWOOGO_REGISTRATION_TYPES_FAILED",
        "Unable to load Swoogo registrants for registration type discovery.",
        { details: { cause: error.message } },
      );
    }

    if (!response.ok) {
      lastFailure = { status: response.status };
      continue;
    }

    const registrationTypes = normalizeSwoogoRegistrationTypesFromRegistrants(body);
    if (registrationTypes.length > 0) {
      return registrationTypes;
    }

    foundEmptyRegistrantResponse = true;
  }

  if (foundEmptyRegistrantResponse) {
    return [];
  }

  throw conflict(
    "SWOOGO_REGISTRATION_TYPES_FAILED",
    "Unable to load Swoogo registrants for registration type discovery.",
    { details: lastFailure },
  );
}

async function fetchSwoogoRegistrationTypes(config) {
  const authorization = await requestSwoogoAccessToken(config);
  const endpoints = [
    { path: "api/v1/registration-types", params: { event_id: config.eventId } },
    { path: "api/v1/registrant-types", params: { event_id: config.eventId } },
    { path: "api/v1/registration_types", params: { event_id: config.eventId } },
    { path: "api/v1/registrant_types", params: { event_id: config.eventId } },
    { path: `api/v1/events/${encodeURIComponent(config.eventId)}/registration-types` },
    { path: `api/v1/events/${encodeURIComponent(config.eventId)}/registrant-types` },
  ];
  for (const endpoint of endpoints) {
    const url = buildSwoogoApiUrl(config.baseUrl, endpoint.path, endpoint.params);
    let body;
    let response;

    try {
      ({ body, response } = await fetchJsonWithTimeout(url, {
        headers: {
          Accept: "application/json",
          Authorization: authorization,
        },
        method: "GET",
      }));
    } catch (error) {
      throw conflict(
        "SWOOGO_REGISTRATION_TYPES_FAILED",
        "Unable to load Swoogo registration types. Check the Swoogo event ID and credentials.",
        { details: { cause: error.message } },
      );
    }

    if (response.status === 404) {
      continue;
    }

    if (!response.ok) {
      continue;
    }

    const registrationTypes = normalizeSwoogoRegistrationTypes(body);
    if (registrationTypes.length > 0) {
      return registrationTypes;
    }
  }

  return fetchSwoogoRegistrationTypesFromRegistrants(config, authorization);
}

function swoogoConfigResponse(eventId, eventData = {}) {
  const swoogo = getSwoogoIntegration(eventData);
  const credentials = swoogo.credentials && typeof swoogo.credentials === "object" ? swoogo.credentials : {};
  const credentialsConfigured = Boolean(credentials.consumerKey && credentials.consumerSecret)
    || Boolean(credentials.clientId && credentials.clientSecret)
    || Boolean(credentials.apiKey && credentials.consumerSecret)
    || Boolean(swoogo.consumerKey && swoogo.consumerSecret)
    || Boolean(swoogo.clientId && swoogo.clientSecret);
  const lastTest = swoogo.lastTest && typeof swoogo.lastTest === "object"
    ? {
        checkedAt: dateValue(swoogo.lastTest.checkedAt),
        message: normalizeString(swoogo.lastTest.message, "Not tested"),
        status: normalizeString(swoogo.lastTest.status, "untested"),
      }
    : defaultConnectionResult();

  return {
    baseUrl: normalizeString(swoogo.baseUrl, "https://api.swoogo.com"),
    credentialsConfigured,
    credentialsUpdatedAt: dateValue(swoogo.credentialsUpdatedAt),
    eventId: normalizeString(swoogo.eventId, ""),
    lastTest: credentialsConfigured || lastTest.status !== "success"
      ? lastTest
      : { checkedAt: lastTest.checkedAt, message: "Swoogo credentials are missing.", status: "untested" },
  };
}

function normalizeSendGridTemplateSummaries(value) {
  const templates = Array.isArray(value) ? value : [];
  const byId = new Map();

  for (const template of templates) {
    if (!template || typeof template !== "object") {
      continue;
    }

    const id = normalizeString(template.id, "");
    if (!id) {
      continue;
    }

    byId.set(id, {
      id,
      name: normalizeString(template.name, id),
      updatedAt: dateValue(template.updated_at || template.updatedAt),
    });
  }

  return Array.from(byId.values())
    .sort((left, right) => left.name.localeCompare(right.name));
}

function sendGridConfigResponse(eventId, eventData = {}) {
  const sendgrid = getSendGridIntegration(eventData);
  const credentials = sendgrid.credentials && typeof sendgrid.credentials === "object" ? sendgrid.credentials : {};
  const templates = sendgrid.templates && typeof sendgrid.templates === "object" ? sendgrid.templates : {};
  const availableTemplates = Array.isArray(sendgrid.availableTemplates)
    ? sendgrid.availableTemplates
    : Array.isArray(sendgrid.templateCache)
      ? sendgrid.templateCache
      : [];
  const credentialsConfigured = Boolean(credentials.apiKey)
    || Boolean(sendgrid.apiKey);
  const lastTest = sendgrid.lastTest && typeof sendgrid.lastTest === "object"
    ? {
        checkedAt: dateValue(sendgrid.lastTest.checkedAt),
        message: normalizeString(sendgrid.lastTest.message, "Not tested"),
        status: normalizeString(sendgrid.lastTest.status, "untested"),
      }
    : defaultConnectionResult();

  return {
    availableTemplates: normalizeSendGridTemplateSummaries(availableTemplates),
    credentialsConfigured,
    credentialsUpdatedAt: dateValue(sendgrid.credentialsUpdatedAt),
    fromEmail: normalizeString(sendgrid.fromEmail, ""),
    fromName: normalizeString(sendgrid.fromName, ""),
    lastTest: credentialsConfigured || lastTest.status !== "success"
      ? lastTest
      : { checkedAt: lastTest.checkedAt, message: "SendGrid API key is missing.", status: "untested" },
    replyToEmail: normalizeString(sendgrid.replyToEmail, ""),
    templates: Object.fromEntries(
      Object.entries(templates)
        .filter((entry) => typeof entry[1] === "string")
        .map(([key, value]) => [key, value.trim()]),
    ),
    templatesCachedAt: dateValue(sendgrid.templatesCachedAt),
  };
}

function queueResponse(snapshot, activeTerminalCount = 0) {
  const data = snapshot.data() || {};

  return {
    activeTerminalCount,
    id: data.queueId || snapshot.id,
    name: normalizeString(data.name, snapshot.id),
    registrationTypeIds: normalizeList(data.registrationTypeIds),
    status: normalizeString(data.status, "active"),
  };
}

function registrationTypeResponse(snapshot) {
  const data = snapshot.data() || {};

  return {
    id: data.registrationTypeId || data.registrantTypeId || snapshot.id,
    name: normalizeString(data.name || data.title || data.label, snapshot.id),
  };
}

function attendeeResponse(snapshot) {
  const data = snapshot.data() || {};
  const profile = data.profile && typeof data.profile === "object" ? data.profile : {};
  const credentialing = data.credentialing && typeof data.credentialing === "object" ? data.credentialing : {};
  const name = normalizeString(
    data.name || data.fullName || profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" "),
    snapshot.id,
  );

  return {
    activeBadgeId: normalizeString(credentialing.activeBadgeId || data.activeBadgeId, ""),
    company: normalizeString(data.company || profile.company, ""),
    credentialStatus: normalizeString(credentialing.status || data.credentialStatus, "unknown"),
    email: normalizeString(data.email || profile.email, ""),
    id: data.participantId || data.registrantId || snapshot.id,
    jobTitle: normalizeString(data.jobTitle || profile.jobTitle || profile.title, ""),
    name,
    registrationTypeId: normalizeString(data.registrationTypeId || data.registrantTypeId || profile.registrationTypeId, ""),
    swoogoRegistrantId: normalizeString(data.swoogoRegistrantId || data.registrantId || snapshot.id, snapshot.id),
  };
}

function eventRecordResponse(snapshot) {
  const data = snapshot.data() || {};

  return {
    ...firestoreValue(data),
    id: snapshot.id,
  };
}

function recordTimeValue(record) {
  return String(
    record.updatedAt
      || record.createdAt
      || record.issuedAt
      || record.printedAt
      || record.checkedInAt
      || record.scannedAt
      || "",
  );
}

function sortRecordsByTimeDesc(records) {
  return records.sort((left, right) => recordTimeValue(right).localeCompare(recordTimeValue(left)));
}

async function queryParticipantRecords(eventRef, collectionId, participant) {
  const byId = new Map();
  const collection = eventRef.collection(collectionId);
  const queryKeys = [
    ["participantId", participant.id],
    ["swoogoRegistrantId", participant.swoogoRegistrantId],
    ["registrantId", participant.swoogoRegistrantId],
  ];
  const seenQueries = new Set();
  const queries = queryKeys
    .filter(([key, value]) => {
      const signature = `${key}:${value}`;

      if (!value || seenQueries.has(signature)) {
        return false;
      }

      seenQueries.add(signature);
      return true;
    })
    .map(([key, value]) => collection.where(key, "==", value).limit(100).get());

  const snapshots = await Promise.all(queries);

  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      byId.set(doc.id, eventRecordResponse(doc));
    }
  }

  return sortRecordsByTimeDesc(Array.from(byId.values()));
}

function terminalResponse(snapshot) {
  const data = snapshot.data() || {};

  return {
    id: data.terminalId || snapshot.id,
    lastHeartbeatAt: dateValue(data.lastHeartbeatAt),
    name: normalizeString(data.name, snapshot.id),
    queueIds: normalizeList(data.queueIds),
    status: normalizeString(data.status, "offline"),
    type: normalizeString(data.type, "print"),
  };
}

function memberRoleResponse(snapshot) {
  const data = snapshot.data() || {};

  return {
    email: normalizeString(data.email, ""),
    name: normalizeString(data.name, data.email || snapshot.id),
    roles: normalizeList(data.roles),
    scope: {
      allowedAreaIds: normalizeList(data.allowedAreaIds || data.allowedAreas),
      allowedGateIds: normalizeList(data.allowedGateIds || data.allowedGates),
      allowedQueueIds: normalizeList(data.allowedQueueIds || data.allowedQueues),
      allowedSessionIds: normalizeList(data.allowedSessionIds || data.allowedSessions),
    },
    scopeModes: {
      areas: normalizeScopeMode(data.scopeModes?.areas || data.areaScopeMode),
      gates: normalizeScopeMode(data.scopeModes?.gates || data.gateScopeMode),
      queues: normalizeScopeMode(data.scopeModes?.queues || data.queueScopeMode),
      sessions: normalizeScopeMode(data.scopeModes?.sessions || data.sessionScopeMode),
    },
    uid: snapshot.id,
  };
}

function userResponse(uid, data = {}, source = "firestore") {
  return {
    createdAt: dateValue(data.createdAt),
    disabled: data.disabled === true,
    displayName: normalizeString(data.displayName || data.name, data.email || uid),
    email: normalizeString(data.email, ""),
    source,
    uid,
  };
}

function areaResponse(snapshot) {
  const data = snapshot.data() || {};

  return {
    id: data.areaId || snapshot.id,
    name: normalizeString(data.name, snapshot.id),
    registrationTypeIds: normalizeList(data.registrationTypeIds),
    status: normalizeString(data.status, "active"),
  };
}

function gateResponse(snapshot) {
  const data = snapshot.data() || {};

  return {
    areaId: normalizeString(data.areaId, ""),
    id: data.gateId || snapshot.id,
    name: normalizeString(data.name, snapshot.id),
    status: normalizeString(data.status, "active"),
  };
}

function sessionResponse(snapshot) {
  const data = snapshot.data() || {};

  return {
    areaId: normalizeString(data.areaId, ""),
    id: data.sessionId || snapshot.id,
    name: normalizeString(data.name, snapshot.id),
    status: normalizeString(data.status, "active"),
    swoogoSessionId: normalizeString(data.swoogoSessionId, ""),
  };
}

function buildSafeEventDocument(eventId, body, actor, options = {}) {
  const nowFields = {
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
  const swoogoEventId = normalizeOptionalString(body.swoogoEventId ?? body.swoogo?.eventId);
  const swoogoBaseUrl = normalizeString(body.swoogoBaseUrl ?? body.swoogo?.baseUrl, "https://api.swoogo.com");
  const defaultQueueId = normalizeOptionalString(body.defaultQueueId ?? body.defaults?.queueId);
  const badgeLayoutId = normalizeOptionalString(body.defaultBadgeLayoutId ?? body.defaults?.badgeLayoutId);
  const registrationEnabledAt = options.registrationEnabledAt || serverTimestamp();
  const registration = typeof body.registration === "boolean" ? body.registration : true;

  return {
    ...nowFields,
    defaults: {
      badgeLayoutId,
      queueId: defaultQueueId,
    },
    eventId,
    name: normalizeString(body.name, eventId),
    registration,
    registrationEnabledAt,
    registrationEnabledBy: actor.uid,
    slug: eventId,
    status: normalizeString(body.status, "draft"),
    swoogo: {
      authMode: "client_credentials",
      baseUrl: swoogoBaseUrl,
      credentialsConfigured: false,
      enabled: Boolean(swoogoEventId),
      eventId: swoogoEventId,
    },
    timezone: normalizeString(body.timezone, "America/Sao_Paulo"),
  };
}

function creatorMembershipDocument(actor, existing = {}) {
  return {
    active: true,
    allowedAreaIds: normalizeList(existing.allowedAreaIds || existing.allowedAreas),
    allowedGateIds: normalizeList(existing.allowedGateIds || existing.allowedGates),
    allowedQueueIds: normalizeList(existing.allowedQueueIds || existing.allowedQueues),
    allowedSessionIds: normalizeList(existing.allowedSessionIds || existing.allowedSessions),
    email: actor.email || existing.email || null,
    name: actor.name || existing.name || null,
    roles: Array.from(new Set([...normalizeList(existing.roles), "event_admin", "event_manager"])),
    status: "active",
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
}

function participantImportDocument(participant, config, actor, isCreate) {
  const fullName = normalizeString(participant.fullName, participant.email || participant.id);
  const profile = {
    company: normalizeString(participant.company, ""),
    email: normalizeString(participant.email, ""),
    firstName: normalizeString(participant.firstName, ""),
    fullName,
    jobTitle: normalizeString(participant.jobTitle, ""),
    lastName: normalizeString(participant.lastName, ""),
    registrationTypeId: normalizeString(participant.registrationTypeId, ""),
    registrationTypeName: normalizeString(participant.registrationTypeName, ""),
  };
  const update = {
    company: profile.company,
    email: profile.email,
    fullName,
    jobTitle: profile.jobTitle,
    name: fullName,
    normalizedEmail: normalizeEmail(profile.email),
    participantId: participant.id,
    profile,
    registrationStatus: normalizeString(participant.registrationStatus, "registered"),
    registrationTypeId: profile.registrationTypeId,
    registrationTypeName: profile.registrationTypeName,
    source: {
      importedFromSwoogo: true,
      lastImportAt: serverTimestamp(),
      provider: "swoogo",
    },
    swoogo: {
      eventId: config.eventId,
      lastSyncedAt: serverTimestamp(),
      registrantId: participant.id,
    },
    swoogoEventId: config.eventId,
    swoogoRegistrantId: participant.id,
    updatedAt: serverTimestamp(),
    updatedBy: actor?.uid || "system",
  };

  if (isCreate) {
    update.createdAt = serverTimestamp();
    update.createdBy = actor?.uid || "system";
    update.credentialing = {
      status: "not_started",
      updatedAt: serverTimestamp(),
    };
  }

  return update;
}

function participantHasCredentialingState(data = {}) {
  const credentialing = data.credentialing && typeof data.credentialing === "object" ? data.credentialing : {};
  const status = normalizeString(credentialing.status || data.credentialStatus, "");
  const passiveStatuses = new Set(["", "not_started", "unknown"]);

  return Boolean(
    credentialing.activeBadgeId
      || credentialing.activeCredentialId
      || credentialing.printJobId
      || data.activeBadgeId
      || data.activeCredentialId
      || data.printJobId
      || !passiveStatuses.has(status),
  );
}

function createFirestoreEventStore(db = getFirestoreDb(), auth = getFirebaseAuth()) {
  const events = () => db.collection("events");
  const users = () => db.collection("users");

  async function loadMembership({ actor, eventId }) {
    if (isSuperAdmin(actor)) {
      return {
        active: true,
        roles: ["super_admin"],
        source: "global_role",
      };
    }

    if (canManageCredentialingEvents(actor)) {
      return {
        ...eventManagerMembership(eventId),
        source: "global_role",
      };
    }

    const snapshot = await events().doc(eventId).collection("members").doc(actor.uid).get();

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() || {};

    return {
      active: data.status !== "inactive" && data.active !== false,
      allowedAreaIds: normalizeList(data.allowedAreaIds || data.allowedAreas),
      allowedGateIds: normalizeList(data.allowedGateIds || data.allowedGates),
      allowedQueueIds: normalizeList(data.allowedQueueIds || data.allowedQueues),
      allowedSessionIds: normalizeList(data.allowedSessionIds || data.allowedSessions),
      roles: normalizeList(data.roles),
      source: "firestore",
    };
  }

  async function listCredentialingEvents(actor, options = {}) {
    const snapshot = options.registrationOnly
      ? await events().where("registration", "==", true).get()
      : await events().get();
    const rows = [];

    for (const eventSnapshot of snapshot.docs) {
      const membership = await membershipForEventSnapshot(eventSnapshot, actor);

      if (membership?.active && membership.roles.length > 0) {
        rows.push(eventResponse(
          eventSnapshot,
          canManageCredentialingEvents(actor)
            ? mergeMemberships(eventSnapshot.id, membership, managementMembership(eventSnapshot.id, actor))
            : membership,
        ));
        continue;
      }

      if (canManageCredentialingEvents(actor)) {
        rows.push(eventResponse(eventSnapshot, managementMembership(eventSnapshot.id, actor)));
        continue;
      }
    }

    return rows.sort((left, right) => left.name.localeCompare(right.name));
  }

  async function getEvent(eventId, actor) {
    const snapshot = await events().doc(eventId).get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const membership = await membershipForEventSnapshot(snapshot, actor);

    if (!membership?.active || membership.roles.length === 0) {
      if (canManageCredentialingEvents(actor)) {
        return eventResponse(snapshot, managementMembership(eventId, actor));
      }

      throw notFound("Event not found");
    }

    return eventResponse(
      snapshot,
      canManageCredentialingEvents(actor)
        ? mergeMemberships(eventId, membership, managementMembership(eventId, actor))
        : membership,
    );
  }

  async function createCredentialingEvent(eventId, body, actor) {
    const eventRef = events().doc(eventId);
    const memberRef = eventRef.collection("members").doc(actor.uid);
    let createdSnapshot;

    await db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(eventRef);

      if (existingSnapshot.exists) {
        throw conflict(
          "EVENT_ALREADY_EXISTS",
          "Event already exists. Enable credentialing on the existing event instead.",
        );
      }

      const now = serverTimestamp();
      transaction.set(eventRef, {
        ...buildSafeEventDocument(eventId, body, actor),
        createdAt: now,
        createdBy: actor.uid,
      });
      transaction.set(memberRef, {
        ...creatorMembershipDocument(actor),
        createdAt: now,
        createdBy: actor.uid,
      });
    });

    createdSnapshot = await eventRef.get();
    return eventResponse(createdSnapshot, managementMembership(eventId, actor));
  }

  async function enableCredentialingEvent(eventId, body, actor) {
    const eventRef = events().doc(eventId);
    const memberRef = eventRef.collection("members").doc(actor.uid);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const data = snapshot.data() || {};
    const update = buildSafeEventDocument(eventId, {
      defaultBadgeLayoutId: body.defaultBadgeLayoutId ?? data.defaults?.badgeLayoutId,
      defaultQueueId: body.defaultQueueId ?? data.defaults?.queueId,
      name: body.name ?? data.name ?? eventId,
      registration: body.registration ?? data.registration ?? true,
      status: body.status ?? data.status ?? "draft",
      swoogoBaseUrl: body.swoogoBaseUrl ?? data.swoogo?.baseUrl,
      swoogoEventId: body.swoogoEventId ?? data.swoogo?.eventId,
      timezone: body.timezone ?? data.timezone ?? "America/Sao_Paulo",
    }, actor);

    if (data.registrationEnabledAt) {
      update.registrationEnabledAt = data.registrationEnabledAt;
      update.registrationEnabledBy = data.registrationEnabledBy || actor.uid;
    }

    const memberSnapshot = await memberRef.get();
    const existingMembership = memberSnapshot.exists ? memberSnapshot.data() || {} : {};
    const membershipUpdate = creatorMembershipDocument(actor, existingMembership);

    if (!memberSnapshot.exists) {
      membershipUpdate.createdAt = serverTimestamp();
      membershipUpdate.createdBy = actor.uid;
    }

    await eventRef.set(update, { merge: true });
    await memberRef.set(membershipUpdate, { merge: true });

    const updatedSnapshot = await eventRef.get();
    return eventResponse(updatedSnapshot, managementMembership(eventId, actor));
  }

  async function updateCredentialingEvent(eventId, body, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const data = snapshot.data() || {};
    const update = buildSafeEventDocument(eventId, {
      defaultBadgeLayoutId: body.defaultBadgeLayoutId ?? data.defaults?.badgeLayoutId,
      defaultQueueId: body.defaultQueueId ?? data.defaults?.queueId,
      name: body.name ?? data.name ?? eventId,
      registration: body.registration ?? data.registration ?? true,
      status: body.status ?? data.status ?? "draft",
      swoogoBaseUrl: body.swoogoBaseUrl ?? data.swoogo?.baseUrl,
      swoogoEventId: body.swoogoEventId ?? data.swoogo?.eventId,
      timezone: body.timezone ?? data.timezone ?? "America/Sao_Paulo",
    }, actor);

    if (data.createdAt) {
      update.createdAt = data.createdAt;
      update.createdBy = data.createdBy || actor.uid;
    }

    if (data.registrationEnabledAt) {
      update.registrationEnabledAt = data.registrationEnabledAt;
      update.registrationEnabledBy = data.registrationEnabledBy || actor.uid;
    }

    await eventRef.set(update, { merge: true });

    const updatedSnapshot = await eventRef.get();
    return eventResponse(updatedSnapshot, managementMembership(eventId, actor));
  }

  async function getSwoogoConfig(eventId) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const config = swoogoConfigResponse(eventId, snapshot.data() || {});
    const storedRegistrationTypes = await readStoredRegistrationTypes(eventRef);

    return {
      ...config,
      registrationTypeCount: storedRegistrationTypes.length,
    };
  }

  async function saveSwoogoConfig(eventId, body, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const existing = snapshot.data() || {};
    const current = swoogoConfigResponse(eventId, existing);
    const existingSwoogo = existing.swoogo && typeof existing.swoogo === "object" ? existing.swoogo : {};
    const existingCredentials = existingSwoogo.credentials && typeof existingSwoogo.credentials === "object"
      ? existingSwoogo.credentials
      : {};
    const consumerKey = normalizeOptionalString(body.consumerKey ?? body.apiKey ?? body.clientId);
    const consumerSecret = normalizeOptionalString(body.consumerSecret ?? body.clientSecret);
    const nextEventId = normalizeString(body.eventId, current.eventId);
    const currentEventId = normalizeString(current.eventId, "");
    const eventIdChanged = Boolean(currentEventId && nextEventId && currentEventId !== nextEventId);
    const storedRegistrationTypes = eventIdChanged ? await readStoredRegistrationTypes(eventRef) : [];

    if (eventIdChanged && storedRegistrationTypes.length > 0 && body.clearRegistrationTypesOnEventChange !== true) {
      throw conflict(
        "SWOOGO_EVENT_ID_CHANGE_REQUIRES_CONFIRMATION",
        "Changing the Swoogo event ID will delete imported registration types. Confirm before saving.",
        { details: { registrationTypeCount: storedRegistrationTypes.length } },
      );
    }

    const nextCredentials = {
      consumerKey: consumerKey || existingCredentials.consumerKey || existingCredentials.clientId || existingCredentials.apiKey || null,
      consumerSecret: consumerSecret || existingCredentials.consumerSecret || existingCredentials.clientSecret || null,
    };
    const credentialsConfigured = Boolean(nextCredentials.consumerKey && nextCredentials.consumerSecret);
    const credentialsChanged = Boolean(consumerKey || consumerSecret);
    const next = {
      authMode: "client_credentials",
      baseUrl: normalizeString(body.baseUrl, current.baseUrl),
      enabled: Boolean(normalizeOptionalString(nextEventId)),
      eventId: nextEventId,
      lastTest: current.lastTest,
      credentials: nextCredentials,
      credentialsConfigured,
      ...(credentialsChanged ? { credentialsUpdatedAt: serverTimestamp() } : {}),
      secretRef: deleteField(),
      secretStatus: deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    await eventRef.set({
      swoogo: next,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    if (eventIdChanged && storedRegistrationTypes.length > 0) {
      await deleteStoredRegistrationTypes(eventRef);
    }

    const updatedSnapshot = await eventRef.get();
    const updatedRegistrationTypes = await readStoredRegistrationTypes(eventRef);

    return {
      ...swoogoConfigResponse(eventId, updatedSnapshot.data() || {}),
      registrationTypeCount: updatedRegistrationTypes.length,
    };
  }

  async function testSwoogoConfig(eventId, actor, body = {}) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const data = snapshot.data() || {};
    const config = swoogoConfigResponse(eventId, data);
    const existingSwoogo = data.swoogo && typeof data.swoogo === "object" ? data.swoogo : {};
    const existingCredentials = existingSwoogo.credentials && typeof existingSwoogo.credentials === "object"
      ? existingSwoogo.credentials
      : {};
    const consumerKey = normalizeOptionalString(body.consumerKey ?? body.apiKey ?? body.clientId)
      || existingCredentials.consumerKey
      || existingCredentials.clientId
      || existingCredentials.apiKey
      || null;
    const consumerSecret = normalizeOptionalString(body.consumerSecret ?? body.clientSecret)
      || existingCredentials.consumerSecret
      || existingCredentials.clientSecret
      || null;
    const baseUrl = normalizeString(body.baseUrl, config.baseUrl);
    const swoogoEventId = normalizeString(body.eventId, config.eventId);
    const result = baseUrl && swoogoEventId && consumerKey && consumerSecret
      ? connectionResult("success", "Swoogo configuration is present.")
      : connectionResult("failure", "Swoogo event ID or credentials are missing.");

    await eventRef.set({
      swoogo: {
        lastTest: result,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      },
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    return result;
  }

  async function getSendGridConfig(eventId) {
    const snapshot = await events().doc(eventId).get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    return sendGridConfigResponse(eventId, snapshot.data() || {});
  }

  async function saveSendGridConfig(eventId, body, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const current = sendGridConfigResponse(eventId, snapshot.data() || {});
    const existing = snapshot.data() || {};
    const existingSendgrid = existing.sendgrid && typeof existing.sendgrid === "object" ? existing.sendgrid : {};
    const existingCredentials = existingSendgrid.credentials && typeof existingSendgrid.credentials === "object"
      ? existingSendgrid.credentials
      : {};
    const templates = body.templates && typeof body.templates === "object" ? body.templates : {};
    const apiKey = normalizeOptionalString(body.apiKey);
    const nextCredentials = {
      apiKey: apiKey || existingCredentials.apiKey || null,
    };
    const credentialsConfigured = Boolean(nextCredentials.apiKey);

    await eventRef.set({
      sendgrid: {
        apiKeyConfigured: credentialsConfigured,
        credentials: nextCredentials,
        credentialsConfigured,
        ...(apiKey ? { credentialsUpdatedAt: serverTimestamp() } : {}),
        fromEmail: normalizeString(body.fromEmail, current.fromEmail),
        fromName: normalizeString(body.fromName, current.fromName),
        lastTest: current.lastTest,
        replyToEmail: normalizeString(body.replyToEmail, current.replyToEmail),
        secretRef: deleteField(),
        secretStatus: deleteField(),
        templates: Object.fromEntries(
          Object.entries(templates)
            .filter((entry) => typeof entry[1] === "string")
            .map(([key, value]) => [key, value.trim()]),
        ),
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      },
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    const updatedSnapshot = await eventRef.get();
    return sendGridConfigResponse(eventId, updatedSnapshot.data() || {});
  }

  async function testSendGridConfig(eventId, actor, body = {}) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const data = snapshot.data() || {};
    const clientConfig = getSendGridClientConfig(data, body);
    let result;

    if (!clientConfig.apiKey) {
      result = connectionResult("failure", "SendGrid API key is missing.");
    } else {
      try {
        await requestSendGridJson("templates?generations=dynamic", clientConfig.apiKey);
        result = connectionResult("success", "SendGrid API key can read dynamic templates.");
      } catch (error) {
        result = connectionResult("failure", error.message || "Unable to test SendGrid API key.");
      }
    }

    await eventRef.set({
      sendgrid: {
        lastTest: result,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      },
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    return result;
  }

  async function listSendGridTemplates(eventId, actor, body = {}) {
    const snapshot = await events().doc(eventId).get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    try {
      const clientConfig = getSendGridClientConfig(snapshot.data() || {}, body);
      const responseBody = await requestSendGridJson("templates?generations=dynamic", clientConfig.apiKey);
      const templates = Array.isArray(responseBody.templates)
        ? responseBody.templates
        : Array.isArray(responseBody.result)
          ? responseBody.result
          : [];
      const templateSummaries = normalizeSendGridTemplateSummaries(templates);

      await snapshot.ref.set({
        sendgrid: {
          availableTemplates: templateSummaries,
          templatesCachedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: actor?.uid || "system",
        },
        updatedAt: serverTimestamp(),
        updatedBy: actor?.uid || "system",
      }, { merge: true });

      return templateSummaries;
    } catch (error) {
      if (error.code === "SENDGRID_API_KEY_MISSING") {
        throw conflict("SENDGRID_API_KEY_MISSING", "Save or enter the SendGrid API key before listing templates.");
      }

      throw conflict("SENDGRID_TEMPLATE_LIST_FAILED", "Unable to list SendGrid templates. Check the SendGrid API key.", {
        details: { cause: error.message },
      });
    }
  }

  async function listUsers() {
    const [userSnapshot, authUsers] = await Promise.all([
      users().get(),
      auth.listUsers(1000).then((result) => result.users).catch(() => []),
    ]);
    const byUid = new Map();

    for (const doc of userSnapshot.docs) {
      byUid.set(doc.id, userResponse(doc.id, doc.data() || {}, "firestore"));
    }

    for (const user of authUsers) {
      const current = byUid.get(user.uid);
      byUid.set(user.uid, {
        ...(current || {}),
        createdAt: user.metadata?.creationTime || current?.createdAt || null,
        disabled: user.disabled === true,
        displayName: normalizeString(user.displayName, current?.displayName || user.email || user.uid),
        email: normalizeString(user.email, current?.email || ""),
        source: current ? "merged" : "auth",
        uid: user.uid,
      });
    }

    return Array.from(byUid.values())
      .sort((left, right) => (left.email || left.displayName || left.uid).localeCompare(right.email || right.displayName || right.uid));
  }

  async function createUser(_eventId, body, actor) {
    const user = await auth.createUser({
      displayName: normalizeString(body.displayName, body.email),
      email: normalizeString(body.email),
      emailVerified: false,
      password: body.password,
    });
    const userRef = users().doc(user.uid);
    const update = {
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      disabled: user.disabled === true,
      displayName: normalizeString(user.displayName, user.email || user.uid),
      email: normalizeString(user.email, ""),
      uid: user.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    await userRef.set(update, { merge: true });

    const userSnapshot = await userRef.get();
    return userResponse(user.uid, userSnapshot.data() || update, "merged");
  }

  async function readStoredRegistrationTypes(eventRef) {
    const [registrationTypesSnapshot, registrantTypesSnapshot] = await Promise.all([
      eventRef.collection("registrationTypes").get(),
      eventRef.collection("registrantTypes").get(),
    ]);
    const byId = new Map();

    for (const doc of [...registrationTypesSnapshot.docs, ...registrantTypesSnapshot.docs]) {
      const type = registrationTypeResponse(doc);
      byId.set(type.id, type);
    }

    return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  async function deleteStoredRegistrationTypes(eventRef) {
    const [registrationTypesSnapshot, registrantTypesSnapshot] = await Promise.all([
      eventRef.collection("registrationTypes").get(),
      eventRef.collection("registrantTypes").get(),
    ]);

    await Promise.all(
      [...registrationTypesSnapshot.docs, ...registrantTypesSnapshot.docs].map((doc) => doc.ref.delete()),
    );
  }

  async function deleteDocumentsInBatches(docs) {
    const chunkSize = 400;
    let deletedCount = 0;

    for (let offset = 0; offset < docs.length; offset += chunkSize) {
      const batch = db.batch();
      const chunk = docs.slice(offset, offset + chunkSize);

      chunk.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      deletedCount += chunk.length;
    }

    return deletedCount;
  }

  async function deleteStoredSwoogoRegistrationTypes(eventRef) {
    const [registrationTypesSnapshot, registrantTypesSnapshot] = await Promise.all([
      eventRef.collection("registrationTypes").get(),
      eventRef.collection("registrantTypes").get(),
    ]);
    const docs = [...registrationTypesSnapshot.docs, ...registrantTypesSnapshot.docs]
      .filter((doc) => {
        const data = doc.data() || {};

        return data.source === "swoogo" || Boolean(data.swoogoEventId);
      });

    return deleteDocumentsInBatches(docs);
  }

  async function deleteCachedSwoogoParticipants(eventRef) {
    const snapshot = await eventRef.collection("participants").where("source.importedFromSwoogo", "==", true).get();
    const deletableDocs = [];
    let skippedCount = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data() || {};

      if (participantHasCredentialingState(data)) {
        skippedCount += 1;
        continue;
      }

      deletableDocs.push(doc);
    }

    return {
      deletedCount: await deleteDocumentsInBatches(deletableDocs),
      skippedCount,
    };
  }

  async function writeRegistrationTypes(eventRef, registrationTypes, swoogoEventId, actor) {
    await Promise.all(registrationTypes.map((type) => eventRef.collection("registrationTypes").doc(normalizeSlug(type.id, type.id)).set({
      name: type.name,
      registrationTypeId: type.id,
      source: "swoogo",
      swoogoEventId,
      syncedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actor?.uid || "system",
    }, { merge: true })));
  }

  async function syncSwoogoRegistrationTypes(eventRef, eventData, actor) {
    const config = getSwoogoClientConfig(eventData);

    if (!config.ready) {
      return [];
    }

    const registrationTypes = await fetchSwoogoRegistrationTypes(config);
    await writeRegistrationTypes(eventRef, registrationTypes, config.eventId, actor);
    return registrationTypes;
  }

  async function writeSwoogoParticipants(eventRef, participants, config, actor) {
    const chunkSize = 400;
    let createdCount = 0;
    let updatedCount = 0;

    for (let offset = 0; offset < participants.length; offset += chunkSize) {
      const chunk = participants.slice(offset, offset + chunkSize);
      const refs = chunk.map((participant) => eventRef.collection("participants").doc(participant.id));
      const snapshots = await Promise.all(refs.map((ref) => ref.get()));
      const batch = db.batch();

      snapshots.forEach((snapshot, index) => {
        const isCreate = !snapshot.exists;

        if (isCreate) {
          createdCount += 1;
        } else {
          updatedCount += 1;
        }

        batch.set(
          refs[index],
          participantImportDocument(chunk[index], config, actor, isCreate),
          { merge: true },
        );
      });

      await batch.commit();
    }

    return {
      createdCount,
      updatedCount,
    };
  }

  async function importSwoogoParticipants(eventId, actor, body = {}) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const existing = snapshot.data() || {};
    const current = swoogoConfigResponse(eventId, existing);
    const existingSwoogo = getSwoogoIntegration(existing);
    const existingCredentials = existingSwoogo.credentials && typeof existingSwoogo.credentials === "object"
      ? existingSwoogo.credentials
      : {};
    const consumerKey = normalizeOptionalString(body.consumerKey ?? body.apiKey ?? body.clientId)
      || existingCredentials.consumerKey
      || existingCredentials.clientId
      || existingCredentials.apiKey
      || null;
    const consumerSecret = normalizeOptionalString(body.consumerSecret ?? body.clientSecret)
      || existingCredentials.consumerSecret
      || existingCredentials.clientSecret
      || null;
    const importConfig = {
      baseUrl: normalizeString(body.baseUrl, current.baseUrl),
      consumerKey,
      consumerSecret,
      eventId: normalizeString(body.eventId, current.eventId),
    };

    if (!importConfig.eventId || !importConfig.consumerKey || !importConfig.consumerSecret) {
      throw conflict(
        "SWOOGO_CREDENTIALS_MISSING",
        "Swoogo event ID, API key, and secret are required before importing participants.",
      );
    }

    const result = await fetchSwoogoParticipants(importConfig, {
      maxPages: body.maxPages,
      perPage: body.perPage,
    });
    const writeResult = await writeSwoogoParticipants(eventRef, result.participants, importConfig, actor);

    await eventRef.set({
      swoogo: {
        authMode: "client_credentials",
        baseUrl: importConfig.baseUrl,
        credentials: {
          consumerKey: importConfig.consumerKey,
          consumerSecret: importConfig.consumerSecret,
        },
        credentialsConfigured: true,
        enabled: true,
        eventId: importConfig.eventId,
        lastParticipantsImport: {
          createdCount: writeResult.createdCount,
          importedAt: serverTimestamp(),
          importedBy: actor.uid,
          importedCount: result.participants.length,
          skippedCount: result.skippedCount,
          updatedCount: writeResult.updatedCount,
        },
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      },
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    return {
      createdCount: writeResult.createdCount,
      importedCount: result.participants.length,
      participantIds: result.participants.map((participant) => participant.id).slice(0, 100),
      skippedCount: result.skippedCount,
      updatedCount: writeResult.updatedCount,
    };
  }

  async function clearSwoogoCache(eventId, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const [participantsResult, registrationTypesDeletedCount] = await Promise.all([
      deleteCachedSwoogoParticipants(eventRef),
      deleteStoredSwoogoRegistrationTypes(eventRef),
    ]);

    await eventRef.set({
      swoogo: {
        cacheClearedAt: serverTimestamp(),
        cacheClearedBy: actor.uid,
        lastParticipantsImport: deleteField(),
        lastRegistrationTypesImport: deleteField(),
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      },
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    const updatedSnapshot = await eventRef.get();
    const storedRegistrationTypes = await readStoredRegistrationTypes(eventRef);

    return {
      config: {
        ...swoogoConfigResponse(eventId, updatedSnapshot.data() || {}),
        registrationTypeCount: storedRegistrationTypes.length,
      },
      participantsDeletedCount: participantsResult.deletedCount,
      participantsSkippedCount: participantsResult.skippedCount,
      registrationTypesDeletedCount,
    };
  }

  async function importSwoogoRegistrationTypes(eventId, actor, body = {}) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const existing = snapshot.data() || {};
    const current = swoogoConfigResponse(eventId, existing);
    const existingSwoogo = getSwoogoIntegration(existing);
    const existingCredentials = existingSwoogo.credentials && typeof existingSwoogo.credentials === "object"
      ? existingSwoogo.credentials
      : {};
    const consumerKey = normalizeOptionalString(body.consumerKey ?? body.apiKey ?? body.clientId)
      || existingCredentials.consumerKey
      || existingCredentials.clientId
      || existingCredentials.apiKey
      || null;
    const consumerSecret = normalizeOptionalString(body.consumerSecret ?? body.clientSecret)
      || existingCredentials.consumerSecret
      || existingCredentials.clientSecret
      || null;
    const importConfig = {
      baseUrl: normalizeString(body.baseUrl, current.baseUrl),
      consumerKey,
      consumerSecret,
      eventId: normalizeString(body.eventId, current.eventId),
    };
    const storedRegistrationTypes = await readStoredRegistrationTypes(eventRef);
    const currentEventId = normalizeString(current.eventId, "");
    const eventIdChanged = Boolean(currentEventId && importConfig.eventId && currentEventId !== importConfig.eventId);

    if (!importConfig.eventId || !importConfig.consumerKey || !importConfig.consumerSecret) {
      throw conflict(
        "SWOOGO_CREDENTIALS_MISSING",
        "Swoogo event ID, API key, and secret are required before importing registration types.",
      );
    }

    if (eventIdChanged && storedRegistrationTypes.length > 0 && body.replaceExisting !== true) {
      throw conflict(
        "SWOOGO_EVENT_ID_CHANGE_REQUIRES_CONFIRMATION",
        "Changing the Swoogo event ID will delete imported registration types. Confirm before importing.",
        { details: { registrationTypeCount: storedRegistrationTypes.length } },
      );
    }

    const registrationTypes = await fetchSwoogoRegistrationTypes(importConfig);

    if (eventIdChanged || body.replaceExisting === true) {
      await deleteStoredRegistrationTypes(eventRef);
    }

    await eventRef.set({
      swoogo: {
        authMode: "client_credentials",
        baseUrl: importConfig.baseUrl,
        credentials: {
          consumerKey: importConfig.consumerKey,
          consumerSecret: importConfig.consumerSecret,
        },
        credentialsConfigured: true,
        enabled: true,
        eventId: importConfig.eventId,
        lastRegistrationTypesImport: {
          importedAt: serverTimestamp(),
          importedBy: actor.uid,
          count: registrationTypes.length,
        },
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      },
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });
    await writeRegistrationTypes(eventRef, registrationTypes, importConfig.eventId, actor);

    const updatedSnapshot = await eventRef.get();
    return {
      config: {
        ...swoogoConfigResponse(eventId, updatedSnapshot.data() || {}),
        registrationTypeCount: registrationTypes.length,
      },
      importedCount: registrationTypes.length,
      registrationTypes,
    };
  }

  async function listRegistrationTypes(eventId, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const storedRegistrationTypes = await readStoredRegistrationTypes(eventRef);

    return storedRegistrationTypes;
  }

  async function listAttendees(eventId) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const attendeeSnapshot = await eventRef.collection("participants").limit(500).get();

    return attendeeSnapshot.docs
      .map((attendee) => attendeeResponse(attendee))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function getAttendeeDetail(eventId, attendeeId) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const attendeeRef = eventRef.collection("participants").doc(normalizeString(attendeeId));
    const attendeeSnapshot = await attendeeRef.get();

    if (!attendeeSnapshot.exists) {
      throw notFound("Attendee not found");
    }

    const attendee = attendeeResponse(attendeeSnapshot);
    const [
      credentials,
      printJobs,
      sessionCheckins,
      areaPassages,
      accessPassagesSnapshot,
    ] = await Promise.all([
      queryParticipantRecords(eventRef, "credentials", attendee),
      queryParticipantRecords(eventRef, "printJobs", attendee),
      queryParticipantRecords(eventRef, "sessionCheckins", attendee),
      queryParticipantRecords(eventRef, "areaPassages", attendee),
      attendeeRef.collection("accessPassages").limit(100).get(),
    ]);

    return {
      attendee,
      areaPassages,
      credentials,
      participant: eventRecordResponse(attendeeSnapshot),
      participantAccessPassages: sortRecordsByTimeDesc(accessPassagesSnapshot.docs.map((doc) => eventRecordResponse(doc))),
      printJobs,
      sessionCheckins,
    };
  }

  async function reissueCredential(eventId, attendeeId, actor) {
    const eventRef = events().doc(eventId);
    const attendeeRef = eventRef.collection("participants").doc(attendeeId);
    const attendeeSnapshot = await attendeeRef.get();

    if (!attendeeSnapshot.exists) {
      throw notFound("Attendee not found");
    }

    const attendee = attendeeResponse(attendeeSnapshot);
    const previousBadgeId = attendee.activeBadgeId;
    const credentialRef = eventRef.collection("credentials").doc();
    const printJobRef = eventRef.collection("printJobs").doc(`reissue-${credentialRef.id}`);
    const epochSeconds = Math.floor(Date.now() / 1000);
    const credentialQrPayload = `${credentialRef.id};${epochSeconds};${attendee.swoogoRegistrantId}`;

    if (previousBadgeId) {
      await eventRef.collection("credentials").doc(previousBadgeId).set({
        cancelledAt: serverTimestamp(),
        cancelledBy: actor.uid,
        reissuedAsBadgeId: credentialRef.id,
        status: "void",
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      }, { merge: true });
    }

    await credentialRef.set({
      badgeId: credentialRef.id,
      credentialQrPayload,
      issuedAt: serverTimestamp(),
      issuedBy: actor.uid,
      participantId: attendee.id,
      printJobId: printJobRef.id,
      status: "issued",
      swoogoRegistrantId: attendee.swoogoRegistrantId,
    });

    await printJobRef.set({
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      credentialBadgeId: credentialRef.id,
      credentialQrPayload,
      participantId: attendee.id,
      priority: 5,
      reason: "manual_reissue",
      status: "queued",
    });

    await attendeeRef.set({
      credentialing: {
        activeBadgeId: credentialRef.id,
        activeCredentialId: credentialRef.id,
        printJobId: printJobRef.id,
        status: "queued",
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      },
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    const updatedAttendee = await attendeeRef.get();

    return {
      attendee: attendeeResponse(updatedAttendee),
      credentialBadgeId: credentialRef.id,
      printJobId: printJobRef.id,
    };
  }

  async function listAreas(eventId) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const areaSnapshot = await eventRef.collection("areas").get();

    return areaSnapshot.docs
      .map((area) => areaResponse(area))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function saveArea(eventId, areaId, body, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const safeAreaId = normalizeSlug(areaId || body.areaId || body.id || body.name);
    const areaRef = eventRef.collection("areas").doc(safeAreaId);

    await areaRef.set({
      areaId: safeAreaId,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      name: normalizeString(body.name, safeAreaId),
      registrationTypeIds: normalizeList(body.registrationTypeIds),
      status: normalizeString(body.status, "active"),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    const updatedSnapshot = await areaRef.get();
    return areaResponse(updatedSnapshot);
  }

  async function listGates(eventId) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const gateSnapshot = await eventRef.collection("gates").get();

    return gateSnapshot.docs
      .map((gate) => gateResponse(gate))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function saveGate(eventId, gateId, body, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const safeGateId = normalizeSlug(gateId || body.gateId || body.id || body.name);
    const gateRef = eventRef.collection("gates").doc(safeGateId);

    await gateRef.set({
      areaId: normalizeString(body.areaId, ""),
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      gateId: safeGateId,
      name: normalizeString(body.name, safeGateId),
      status: normalizeString(body.status, "active"),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    const updatedSnapshot = await gateRef.get();
    return gateResponse(updatedSnapshot);
  }

  async function listSessions(eventId) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const sessionSnapshot = await eventRef.collection("sessions").get();

    return sessionSnapshot.docs
      .map((session) => sessionResponse(session))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function saveSession(eventId, sessionId, body, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const safeSessionId = normalizeSlug(sessionId || body.sessionId || body.id || body.name);
    const sessionRef = eventRef.collection("sessions").doc(safeSessionId);

    await sessionRef.set({
      areaId: normalizeString(body.areaId, ""),
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      name: normalizeString(body.name, safeSessionId),
      sessionId: safeSessionId,
      status: normalizeString(body.status, "active"),
      swoogoSessionId: normalizeString(body.swoogoSessionId, ""),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    const updatedSnapshot = await sessionRef.get();
    return sessionResponse(updatedSnapshot);
  }

  async function listQueues(eventId) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const [queueSnapshot, terminalSnapshot] = await Promise.all([
      eventRef.collection("queues").get(),
      eventRef.collection("terminals").get(),
    ]);
    const terminals = terminalSnapshot.docs.map((terminal) => terminalResponse(terminal));

    return queueSnapshot.docs
      .map((queue) => {
        const activeTerminalCount = terminals.filter((terminal) =>
          terminal.status !== "disabled" && terminal.queueIds.includes(queue.id)
        ).length;

        return queueResponse(queue, activeTerminalCount);
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function getQueueDependencies(eventRef, eventData, queueId) {
    const terminalSnapshot = await eventRef.collection("terminals").get();
    const assignedTerminals = terminalSnapshot.docs
      .map((terminal) => terminalResponse(terminal))
      .filter((terminal) => terminal.status !== "disabled" && terminal.queueIds.includes(queueId));
    const defaults = eventData.defaults && typeof eventData.defaults === "object" ? eventData.defaults : {};

    return {
      assignedTerminals,
      isFallbackQueue: defaults.queueId === queueId,
    };
  }

  async function saveQueue(eventId, queueId, body, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const safeQueueId = normalizeSlug(queueId || body.queueId || body.id || body.name);
    const queueRef = eventRef.collection("queues").doc(safeQueueId);
    const data = snapshot.data() || {};
    const nextStatus = normalizeString(body.status, "active");

    if (nextStatus === "disabled") {
      const { assignedTerminals, isFallbackQueue } = await getQueueDependencies(eventRef, data, safeQueueId);

      if (isFallbackQueue || assignedTerminals.length > 0) {
        throw conflict(
          "QUEUE_DISABLE_BLOCKED",
          "Queue cannot be disabled while it is assigned to fallback routing or active terminals.",
          {
            details: {
              fallbackQueue: isFallbackQueue,
              terminalIds: assignedTerminals.map((terminal) => terminal.id),
            },
          },
        );
      }
    }

    await queueRef.set({
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      name: normalizeString(body.name, safeQueueId),
      queueId: safeQueueId,
      registrationTypeIds: normalizeList(body.registrationTypeIds),
      status: nextStatus,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    const updatedSnapshot = await queueRef.get();
    return queueResponse(updatedSnapshot);
  }

  async function deleteQueue(eventId, queueId, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const safeQueueId = normalizeSlug(queueId);
    const queueRef = eventRef.collection("queues").doc(safeQueueId);
    const queueSnapshot = await queueRef.get();

    if (!queueSnapshot.exists) {
      throw notFound("Queue not found");
    }

    const { assignedTerminals, isFallbackQueue } = await getQueueDependencies(eventRef, snapshot.data() || {}, safeQueueId);

    if (isFallbackQueue || assignedTerminals.length > 0) {
      throw conflict(
        "QUEUE_DELETE_BLOCKED",
        "Queue cannot be deleted while it is assigned to fallback routing or active terminals.",
        {
          details: {
            fallbackQueue: isFallbackQueue,
            terminalIds: assignedTerminals.map((terminal) => terminal.id),
          },
        },
      );
    }

    await queueRef.delete();

    return {
      deleted: true,
      id: safeQueueId,
      updatedBy: actor.uid,
    };
  }

  async function listTerminals(eventId) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const terminalSnapshot = await eventRef.collection("terminals").get();

    return terminalSnapshot.docs
      .map((terminal) => terminalResponse(terminal))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function listRoles(eventId) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const memberSnapshot = await eventRef.collection("members").get();

    return memberSnapshot.docs
      .map((member) => memberRoleResponse(member))
      .sort((left, right) => {
        const leftLabel = left.email || left.name || left.uid;
        const rightLabel = right.email || right.name || right.uid;

        return leftLabel.localeCompare(rightLabel);
      });
  }

  async function saveRole(eventId, uid, body, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const safeUid = normalizeString(uid || body.uid);
    const memberRef = eventRef.collection("members").doc(safeUid);
    const memberSnapshot = await memberRef.get();
    const scope = body.scope || {};
    const scopeModes = body.scopeModes || {};
    const active = body.active !== false;
    const update = {
      active,
      allowedAreaIds: normalizeList(scope.allowedAreaIds || body.allowedAreaIds),
      allowedGateIds: normalizeList(scope.allowedGateIds || body.allowedGateIds),
      allowedQueueIds: normalizeList(scope.allowedQueueIds || body.allowedQueueIds),
      allowedSessionIds: normalizeList(scope.allowedSessionIds || body.allowedSessionIds),
      email: normalizeString(body.email),
      name: normalizeString(body.name, body.email || safeUid),
      roles: normalizeList(body.roles),
      scopeModes: {
        areas: normalizeScopeMode(scopeModes.areas),
        gates: normalizeScopeMode(scopeModes.gates),
        queues: normalizeScopeMode(scopeModes.queues),
        sessions: normalizeScopeMode(scopeModes.sessions),
      },
      status: active ? "active" : "inactive",
      uid: safeUid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    if (!memberSnapshot.exists) {
      update.createdAt = serverTimestamp();
      update.createdBy = actor.uid;
    }

    await memberRef.set(update, { merge: true });

    const updatedSnapshot = await memberRef.get();
    return memberRoleResponse(updatedSnapshot);
  }

  async function saveTerminal(eventId, terminalId, body, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const safeTerminalId = normalizeSlug(terminalId || body.terminalId || body.id || body.name);
    const terminalRef = eventRef.collection("terminals").doc(safeTerminalId);

    await terminalRef.set({
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      name: normalizeString(body.name, safeTerminalId),
      queueIds: normalizeList(body.queueIds),
      status: normalizeString(body.status, "offline"),
      terminalId: safeTerminalId,
      type: normalizeString(body.type, "print"),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true });

    const updatedSnapshot = await terminalRef.get();
    return terminalResponse(updatedSnapshot);
  }

  async function deleteTerminal(eventId, terminalId, actor) {
    const eventRef = events().doc(eventId);
    const snapshot = await eventRef.get();

    if (!snapshot.exists) {
      throw notFound("Event not found");
    }

    const safeTerminalId = normalizeSlug(terminalId);
    const terminalRef = eventRef.collection("terminals").doc(safeTerminalId);
    const terminalSnapshot = await terminalRef.get();

    if (!terminalSnapshot.exists) {
      throw notFound("Terminal not found");
    }

    await terminalRef.delete();

    return {
      deleted: true,
      id: safeTerminalId,
      updatedBy: actor.uid,
    };
  }

  return {
    clearSwoogoCache,
    createUser,
    createCredentialingEvent,
    deleteQueue,
    deleteTerminal,
    enableCredentialingEvent,
    getSendGridConfig,
    getAttendeeDetail,
    getEvent,
    getSwoogoConfig,
    importSwoogoParticipants,
    importSwoogoRegistrationTypes,
    listAreas,
    listAttendees,
    listCredentialingEvents,
    listGates,
    listQueues,
    listRegistrationTypes,
    listRoles,
    listSendGridTemplates,
    listSessions,
    listTerminals,
    listUsers,
    loadMembership,
    reissueCredential,
    saveArea,
    saveGate,
    saveQueue,
    saveRole,
    saveSession,
    saveSendGridConfig,
    saveSwoogoConfig,
    saveTerminal,
    testSendGridConfig,
    testSwoogoConfig,
    updateCredentialingEvent,
  };
}

module.exports = {
  __test__: {
    normalizeSwoogoRegistrationTypes,
    normalizeSwoogoRegistrationTypesFromRegistrants,
    normalizeSwoogoParticipants,
    swoogoRegistrationTypeDiscoveryParams,
    swoogoParticipantRequestParams,
  },
  canManageCredentialingEvents,
  createFirestoreEventStore,
  isSuperAdmin,
};
