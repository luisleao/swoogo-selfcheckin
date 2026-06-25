#!/usr/bin/env node
"use strict";

require("dotenv").config({ quiet: true });

const { FieldValue } = require("firebase-admin/firestore");
const {
  FIRESTORE_DATABASE_ID,
  getFirebaseAuth,
  getFirestoreDb,
} = require("../src/api/firebase-admin");
const { DEFAULT_LAYOUT } = require("../workers/print-worker/lib/render-data");

const DEFAULT_SEED_OPTIONS = Object.freeze({
  adminEmail: "admin@example.com",
  adminName: "Event Admin",
  adminPassword: "",
  adminUid: "",
  dryRun: false,
  eventName: "Demo Credentialing Summit",
  eventSlug: "demo-credentialing-summit",
  sendgridFromEmail: "checkin@example.com",
  sendgridFromName: "Demo Credentialing",
  skipAuthUser: false,
  swoogoBaseUrl: "https://api.swoogo.com",
  swoogoEventId: "demo-swoogo-event",
  timezone: "America/Sao_Paulo",
});

const EVENT_ROLES = Object.freeze([
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

const GLOBAL_ROLES = Object.freeze(["super_admin", "event_manager"]);

const OPTION_ALIASES = Object.freeze({
  "admin-email": "adminEmail",
  "admin-name": "adminName",
  "admin-password": "adminPassword",
  "admin-uid": "adminUid",
  "dry-run": "dryRun",
  "event-name": "eventName",
  "event-slug": "eventSlug",
  "sendgrid-from-email": "sendgridFromEmail",
  "sendgrid-from-name": "sendgridFromName",
  "skip-auth-user": "skipAuthUser",
  "swoogo-base-url": "swoogoBaseUrl",
  "swoogo-event-id": "swoogoEventId",
  timezone: "timezone",
});

const ENV_OPTIONS = Object.freeze({
  adminEmail: "SETUP_ADMIN_EMAIL",
  adminName: "SETUP_ADMIN_NAME",
  adminPassword: "SETUP_ADMIN_PASSWORD",
  adminUid: "SETUP_ADMIN_UID",
  eventName: "SETUP_EVENT_NAME",
  eventSlug: "SETUP_EVENT_SLUG",
  sendgridFromEmail: "SETUP_SENDGRID_FROM_EMAIL",
  sendgridFromName: "SETUP_SENDGRID_FROM_NAME",
  swoogoBaseUrl: "SETUP_SWOOGO_BASE_URL",
  swoogoEventId: "SETUP_SWOOGO_EVENT_ID",
  timezone: "SETUP_TIMEZONE",
});

const SEED_SOURCE = "firestore-setup";

function usageText() {
  return `
Usage:
  npm run setup:firestore -- [options]

Required for first-run Auth user creation:
  SETUP_ADMIN_EMAIL=admin@example.com SETUP_ADMIN_PASSWORD='change-me'

Options:
  --event-slug <slug>              Firestore event document id.
  --event-name <name>              Event display name.
  --timezone <tz>                  Event timezone.
  --admin-email <email>            Firebase Auth admin email.
  --admin-password <password>      Password used only when creating a missing admin user.
  --admin-name <name>              Firebase Auth display name.
  --skip-auth-user                 Do not create/update Firebase Auth; requires --admin-uid.
  --admin-uid <uid>                Existing Firebase UID for --skip-auth-user.
  --swoogo-event-id <id>           Safe Swoogo event id metadata placeholder.
  --swoogo-base-url <url>          Swoogo API base URL.
  --sendgrid-from-email <email>    Seed SendGrid sender email metadata.
  --sendgrid-from-name <name>      Seed SendGrid sender name metadata.
  --dry-run                        Print the seed plan without writing Firestore/Auth.
`.trim();
}

function normalizeSlug(value, fallback = "demo-credentialing-summit") {
  return String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeEmail(value, fallback = "") {
  return String(value || fallback).trim().toLowerCase();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function readOptionValue(argv, index, raw) {
  const equalsIndex = raw.indexOf("=");

  if (equalsIndex !== -1) {
    return {
      consumed: 0,
      value: raw.slice(equalsIndex + 1),
    };
  }

  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    return {
      consumed: 0,
      value: true,
    };
  }

  return {
    consumed: 1,
    value: next,
  };
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = { ...DEFAULT_SEED_OPTIONS };

  for (const [key, envName] of Object.entries(ENV_OPTIONS)) {
    if (env[envName]) {
      options[key] = env[envName];
    }
  }

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];

    if (raw === "--help" || raw === "-h") {
      return {
        ...options,
        help: true,
      };
    }

    if (!raw.startsWith("--")) {
      throw new Error(`Unsupported argument: ${raw}`);
    }

    const rawName = raw.slice(2).split("=")[0];
    const optionName = OPTION_ALIASES[rawName];

    if (!optionName) {
      throw new Error(`Unsupported option: --${rawName}`);
    }

    if (typeof DEFAULT_SEED_OPTIONS[optionName] === "boolean") {
      options[optionName] = true;
      continue;
    }

    const { consumed, value } = readOptionValue(argv, index, raw);
    if (value === true) {
      throw new Error(`--${rawName} requires a value`);
    }

    options[optionName] = String(value);
    index += consumed;
  }

  options.adminEmail = normalizeEmail(options.adminEmail, DEFAULT_SEED_OPTIONS.adminEmail);
  options.eventSlug = normalizeSlug(options.eventSlug);
  options.swoogoBaseUrl = String(options.swoogoBaseUrl || DEFAULT_SEED_OPTIONS.swoogoBaseUrl).replace(/\/+$/, "");

  return options;
}

function validateOptions(options) {
  if (!options.eventSlug) {
    throw new Error("eventSlug is required.");
  }

  if (!options.adminEmail.includes("@")) {
    throw new Error("adminEmail must be a valid email address.");
  }

  if (options.skipAuthUser && !options.adminUid) {
    throw new Error("--skip-auth-user requires --admin-uid or SETUP_ADMIN_UID.");
  }
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function buildCredentialQrPayload(badgeId, issuedAt, participantId) {
  return `${badgeId};${Math.floor(issuedAt.getTime() / 1000)};${participantId}`;
}

function buildSeedDataset(options = {}) {
  const seedOptions = {
    ...DEFAULT_SEED_OPTIONS,
    ...options,
  };
  const eventId = normalizeSlug(seedOptions.eventSlug);
  const createdAt = seedOptions.createdAt instanceof Date
    ? seedOptions.createdAt
    : new Date("2026-06-25T12:00:00.000Z");
  const updatedAt = seedOptions.updatedAt instanceof Date ? seedOptions.updatedAt : createdAt;
  const adminUid = seedOptions.adminUid || "seed-admin";
  const adminEmail = normalizeEmail(seedOptions.adminEmail, DEFAULT_SEED_OPTIONS.adminEmail);
  const adminName = String(seedOptions.adminName || DEFAULT_SEED_OPTIONS.adminName).trim();
  const swoogoEventId = String(seedOptions.swoogoEventId || DEFAULT_SEED_OPTIONS.swoogoEventId).trim();
  const queueIds = {
    general: "general",
    speaker: "speaker",
    vip: "vip",
  };
  const registrationTypes = [
    {
      defaultQueueId: queueIds.general,
      name: "General attendee",
      registrationTypeId: "general",
    },
    {
      defaultQueueId: queueIds.vip,
      name: "VIP",
      registrationTypeId: "vip",
    },
    {
      defaultQueueId: queueIds.speaker,
      name: "Speaker",
      registrationTypeId: "speaker",
    },
    {
      defaultQueueId: queueIds.vip,
      name: "Staff",
      registrationTypeId: "staff",
    },
  ];
  const queues = [
    {
      name: "General pickup",
      priority: 10,
      queueId: queueIds.general,
      registrationTypeIds: ["general"],
    },
    {
      name: "VIP and staff pickup",
      priority: 20,
      queueId: queueIds.vip,
      registrationTypeIds: ["vip", "staff"],
    },
    {
      name: "Speaker pickup",
      priority: 30,
      queueId: queueIds.speaker,
      registrationTypeIds: ["speaker"],
    },
  ];
  const terminals = [
    {
      name: "Front desk pre-check-in",
      queueIds: [],
      terminalId: "precheckin-frontdesk",
      type: "pre-check-in",
    },
    {
      name: "Main badge printer",
      printer: {
        name: "Demo Brother QL-800",
        type: "brother",
      },
      queueIds: [queueIds.general, queueIds.vip, queueIds.speaker],
      terminalId: "print-main",
      type: "print",
    },
    {
      name: "Badge pickup counter",
      queueIds: [queueIds.general, queueIds.vip, queueIds.speaker],
      terminalId: "pickup-counter",
      type: "pickup",
    },
  ];
  const areas = [
    {
      areaId: "lobby",
      defaultDecision: "allow",
      name: "Lobby",
      registrationTypeIds: [],
      type: "public",
    },
    {
      areaId: "auditorium-1",
      defaultDecision: "deny",
      name: "Auditorium 1",
      registrationTypeIds: ["general", "vip", "speaker", "staff"],
      type: "session_room",
    },
    {
      areaId: "vip-lounge",
      defaultDecision: "deny",
      name: "VIP Lounge",
      registrationTypeIds: ["vip", "speaker", "staff"],
      type: "restricted",
    },
  ];
  const gates = [
    {
      areaId: "lobby",
      gateId: "lobby-main",
      name: "Lobby main entrance",
    },
    {
      areaId: "auditorium-1",
      gateId: "auditorium-1-door",
      name: "Auditorium 1 door",
    },
    {
      areaId: "vip-lounge",
      gateId: "vip-lounge-door",
      name: "VIP Lounge door",
    },
  ];
  const sessions = [
    {
      areaId: "auditorium-1",
      capacity: 250,
      date: "2026-07-15",
      endTime: "10:15",
      name: "Opening keynote",
      sessionId: "opening-keynote",
      startTime: "09:00",
      swoogoSessionId: "demo-session-001",
    },
    {
      areaId: "vip-lounge",
      capacity: 40,
      date: "2026-07-15",
      endTime: "12:00",
      name: "VIP roundtable",
      sessionId: "vip-roundtable",
      startTime: "11:00",
      swoogoSessionId: "demo-session-002",
    },
  ];
  const participants = [
    {
      company: "Acme Events",
      credentialingStatus: "queued",
      email: "ana.silva@example.com",
      firstName: "Ana",
      fullName: "Ana Silva",
      jobTitle: "Operations Manager",
      lastName: "Silva",
      participantId: "1001",
      queueId: queueIds.general,
      registrationTypeId: "general",
      sessionIds: ["opening-keynote"],
    },
    {
      company: "Northwind",
      credentialingStatus: "delivered",
      email: "bruno.mendes@example.com",
      firstName: "Bruno",
      fullName: "Bruno Mendes",
      jobTitle: "Founder",
      lastName: "Mendes",
      participantId: "1002",
      presence: {
        currentAreaId: "vip-lounge",
        currentAreaName: "VIP Lounge",
      },
      queueId: queueIds.vip,
      registrationTypeId: "vip",
      sessionIds: ["opening-keynote", "vip-roundtable"],
    },
    {
      company: "Future Labs",
      credentialingStatus: "imported",
      email: "clara.rocha@example.com",
      firstName: "Clara",
      fullName: "Clara Rocha",
      jobTitle: "CTO",
      lastName: "Rocha",
      participantId: "1003",
      queueId: queueIds.speaker,
      registrationTypeId: "speaker",
      sessionIds: ["opening-keynote"],
    },
    {
      company: "Event Crew",
      credentialingStatus: "printed",
      email: "diego.staff@example.com",
      firstName: "Diego",
      fullName: "Diego Almeida",
      jobTitle: "Producer",
      lastName: "Almeida",
      participantId: "1004",
      presence: {
        currentAreaId: "lobby",
        currentAreaName: "Lobby",
      },
      queueId: queueIds.vip,
      registrationTypeId: "staff",
      sessionIds: [],
    },
    {
      company: "Contoso",
      credentialingStatus: "delivered",
      email: "marina.costa@example.com",
      firstName: "Marina",
      fullName: "Marina Costa",
      jobTitle: "Partner",
      lastName: "Costa",
      participantId: "1005",
      queueId: queueIds.vip,
      registrationTypeId: "vip",
      reissuedCredential: true,
      sessionIds: ["vip-roundtable"],
    },
    {
      company: "Blue Ocean",
      credentialingStatus: "delivered",
      email: "pedro.lima@example.com",
      firstName: "Pedro",
      fullName: "Pedro Lima",
      jobTitle: "Analyst",
      lastName: "Lima",
      participantId: "1006",
      queueId: queueIds.general,
      registrationTypeId: "general",
      sessionIds: [],
    },
  ];

  return {
    admin: {
      displayName: adminName,
      email: adminEmail,
      uid: adminUid,
    },
    areas,
    createdAt,
    event: {
      defaults: {
        badgeLayoutId: DEFAULT_LAYOUT.layoutId,
        queueId: queueIds.general,
      },
      eventId,
      name: String(seedOptions.eventName || DEFAULT_SEED_OPTIONS.eventName).trim(),
      registration: true,
      sendgrid: {
        apiKeyConfigured: false,
        availableTemplates: [
          {
            id: "d-demo-confirmation",
            name: "Demo confirmation",
            updatedAt: createdAt,
          },
          {
            id: "d-demo-badge-reissue",
            name: "Demo badge reissue",
            updatedAt: createdAt,
          },
        ],
        credentialsConfigured: false,
        enabled: false,
        fromEmail: String(seedOptions.sendgridFromEmail || DEFAULT_SEED_OPTIONS.sendgridFromEmail).trim(),
        fromName: String(seedOptions.sendgridFromName || DEFAULT_SEED_OPTIONS.sendgridFromName).trim(),
        lastTest: {
          checkedAt: null,
          message: "Not tested",
          status: "untested",
        },
        replyToEmail: String(seedOptions.sendgridFromEmail || DEFAULT_SEED_OPTIONS.sendgridFromEmail).trim(),
        templates: {
          badgeReissue: "",
          confirmation: "",
          sessionReminder: "",
        },
        templatesCachedAt: createdAt,
      },
      slug: eventId,
      status: "active",
      swoogo: {
        authMode: "client_credentials",
        baseUrl: String(seedOptions.swoogoBaseUrl || DEFAULT_SEED_OPTIONS.swoogoBaseUrl).replace(/\/+$/, ""),
        credentialsConfigured: false,
        enabled: Boolean(swoogoEventId),
        eventId: swoogoEventId,
        lastTest: {
          checkedAt: null,
          message: "Not tested",
          status: "untested",
        },
      },
      timezone: String(seedOptions.timezone || DEFAULT_SEED_OPTIONS.timezone).trim(),
    },
    gates,
    participants,
    queues,
    registrationTypes,
    sessions,
    terminals,
    updatedAt,
  };
}

function registrationTypeName(dataset, registrationTypeId) {
  return dataset.registrationTypes.find((type) => type.registrationTypeId === registrationTypeId)?.name
    || registrationTypeId;
}

function payloadSnapshotForParticipant(participant, credentialQrPayload, credentialBadgeId, dataset) {
  return {
    company: participant.company,
    credentialBadgeId,
    credentialQrPayload,
    firstName: participant.firstName,
    fullName: participant.fullName,
    jobTitle: participant.jobTitle,
    participantId: participant.participantId,
    registrationTypeId: participant.registrationTypeId,
    registrationTypeName: registrationTypeName(dataset, participant.registrationTypeId),
    swoogoRegistrantId: participant.participantId,
  };
}

function buildBadgeLayoutDoc(dataset) {
  return {
    ...DEFAULT_LAYOUT,
    createdAt: dataset.createdAt,
    createdBy: dataset.admin.uid,
    eventId: dataset.event.eventId,
    layoutId: DEFAULT_LAYOUT.layoutId,
    publishedAt: dataset.createdAt,
    publishedBy: dataset.admin.uid,
    registrationTypeIds: [],
    status: "published",
    updatedAt: dataset.updatedAt,
    updatedBy: dataset.admin.uid,
    version: DEFAULT_LAYOUT.layoutVersion,
  };
}

function buildParticipantDoc(participant, dataset, credential) {
  const precheckedAt = ["queued", "printed", "delivered"].includes(participant.credentialingStatus)
    ? addMinutes(dataset.createdAt, 5)
    : null;
  const deliveredAt = participant.credentialingStatus === "delivered" ? addMinutes(dataset.createdAt, 45) : null;
  const printedAt = ["printed", "delivered"].includes(participant.credentialingStatus)
    ? addMinutes(dataset.createdAt, 25)
    : null;
  const presence = participant.presence
    ? {
        currentAreaEnteredAt: addMinutes(dataset.createdAt, 50),
        currentAreaId: participant.presence.currentAreaId,
        currentAreaName: participant.presence.currentAreaName,
        lastMovementSource: "seed",
      }
    : {
        currentAreaEnteredAt: null,
        currentAreaId: "",
        currentAreaName: "",
        lastMovementSource: "",
      };

  return {
    company: participant.company,
    createdAt: dataset.createdAt,
    createdBy: SEED_SOURCE,
    credentialing: {
      activeBadgeId: credential?.badgeId || "",
      activeCredentialId: credential?.badgeId || "",
      deliveredAt,
      deliveredBy: deliveredAt ? dataset.admin.uid : "",
      precheckedAt,
      precheckedBy: precheckedAt ? dataset.admin.uid : "",
      printedAt,
      printJobId: credential?.printJobId || "",
      queueId: participant.queueId,
      status: participant.credentialingStatus,
      updatedAt: dataset.updatedAt,
      updatedBy: dataset.admin.uid,
    },
    email: participant.email,
    eventId: dataset.event.eventId,
    firstName: participant.firstName,
    fullName: participant.fullName,
    jobTitle: participant.jobTitle,
    lastName: participant.lastName,
    name: participant.fullName,
    normalizedEmail: normalizeEmail(participant.email),
    participantId: participant.participantId,
    presence,
    profile: {
      company: participant.company,
      email: participant.email,
      firstName: participant.firstName,
      fullName: participant.fullName,
      jobTitle: participant.jobTitle,
      lastName: participant.lastName,
      registrationTypeId: participant.registrationTypeId,
      registrationTypeName: registrationTypeName(dataset, participant.registrationTypeId),
    },
    registrationStatus: "registered",
    registrationTypeId: participant.registrationTypeId,
    registrationTypeName: registrationTypeName(dataset, participant.registrationTypeId),
    sessionIds: participant.sessionIds,
    source: {
      importedFromSwoogo: true,
      lastSyncedAt: dataset.updatedAt,
      manualRegistration: false,
      provider: "swoogo",
      system: "seed",
    },
    swoogo: {
      eventId: dataset.event.swoogo.eventId,
      lastSyncedAt: dataset.updatedAt,
      registrantId: participant.participantId,
    },
    swoogoEventId: dataset.event.swoogo.eventId,
    swoogoRegistrantId: participant.participantId,
    updatedAt: dataset.updatedAt,
    updatedBy: dataset.admin.uid,
  };
}

function buildCredentialDoc(participant, dataset, credential) {
  const status = participant.credentialingStatus === "queued"
    ? "reserved"
    : participant.credentialingStatus === "printed"
      ? "issued"
      : "delivered";

  return {
    badgeId: credential.badgeId,
    createdAt: dataset.createdAt,
    createdBy: SEED_SOURCE,
    credentialId: credential.badgeId,
    credentialQrPayload: credential.qrPayload,
    eventId: dataset.event.eventId,
    issuedAt: credential.issuedAt,
    issuedAtEpochSeconds: Math.floor(credential.issuedAt.getTime() / 1000),
    issuedBy: dataset.admin.uid,
    layoutId: DEFAULT_LAYOUT.layoutId,
    layoutVersion: DEFAULT_LAYOUT.layoutVersion,
    participantId: participant.participantId,
    printJobId: credential.printJobId,
    qrPayload: credential.qrPayload,
    queueId: participant.queueId,
    status,
    swoogoRegistrantId: participant.participantId,
    terminalId: status === "reserved" ? "" : "print-main",
    updatedAt: dataset.updatedAt,
    updatedBy: dataset.admin.uid,
    ...(status === "delivered"
      ? {
          deliveredAt: addMinutes(dataset.createdAt, 45),
          deliveredBy: dataset.admin.uid,
        }
      : {}),
  };
}

function buildPrintJobDoc(participant, dataset, credential) {
  const status = participant.credentialingStatus === "queued"
    ? "queued"
    : participant.credentialingStatus === "imported"
      ? "cancelled"
      : "printed";
  const payloadSnapshot = payloadSnapshotForParticipant(participant, credential.qrPayload, credential.badgeId, dataset);

  return {
    attempts: status === "printed" ? 1 : 0,
    createdAt: dataset.createdAt,
    createdBy: SEED_SOURCE,
    credentialBadgeId: credential.badgeId,
    credentialId: credential.badgeId,
    credentialQrPayload: credential.qrPayload,
    eventId: dataset.event.eventId,
    layoutId: DEFAULT_LAYOUT.layoutId,
    layoutVersion: DEFAULT_LAYOUT.layoutVersion,
    participantId: participant.participantId,
    payloadSnapshot,
    printJobId: credential.printJobId,
    priority: participant.registrationTypeId === "vip" ? 20 : 10,
    queueId: participant.queueId,
    reason: "seed",
    status,
    swoogoRegistrantId: participant.participantId,
    terminalId: status === "printed" ? "print-main" : "",
    updatedAt: dataset.updatedAt,
    updatedBy: dataset.admin.uid,
    ...(status === "printed"
      ? {
          completedAt: addMinutes(dataset.createdAt, 30),
          printResult: {
            printerName: "Demo Brother QL-800",
            status: "printed",
          },
        }
      : {}),
  };
}

function buildQueueEntryDoc(participant, dataset, credential) {
  const status = participant.credentialingStatus === "queued"
    ? "waiting"
    : participant.credentialingStatus === "printed"
      ? "ready_for_pickup"
      : "delivered";

  return {
    createdAt: dataset.createdAt,
    credentialBadgeId: credential.badgeId,
    eventId: dataset.event.eventId,
    participantId: participant.participantId,
    printJobId: credential.printJobId,
    priority: participant.registrationTypeId === "vip" ? 20 : 10,
    queueEntryId: `seed-${participant.participantId}`,
    queueId: participant.queueId,
    status,
    updatedAt: dataset.updatedAt,
    ...(status !== "waiting" ? { readyAt: addMinutes(dataset.createdAt, 30) } : {}),
    ...(status === "delivered" ? { deliveredAt: addMinutes(dataset.createdAt, 45) } : {}),
  };
}

function buildVoidedCredentialDoc(participant, dataset, activeCredential) {
  const oldBadgeId = `voided-${participant.participantId}-previous`;
  const issuedAt = addMinutes(dataset.createdAt, -120);
  const qrPayload = buildCredentialQrPayload(oldBadgeId, issuedAt, participant.participantId);

  return {
    badgeId: oldBadgeId,
    createdAt: issuedAt,
    createdBy: SEED_SOURCE,
    credentialId: oldBadgeId,
    credentialQrPayload: qrPayload,
    eventId: dataset.event.eventId,
    issuedAt,
    issuedAtEpochSeconds: Math.floor(issuedAt.getTime() / 1000),
    issuedBy: dataset.admin.uid,
    participantId: participant.participantId,
    qrPayload,
    queueId: participant.queueId,
    replacedByBadgeId: activeCredential.badgeId,
    replacedByCredentialId: activeCredential.badgeId,
    status: "void",
    swoogoRegistrantId: participant.participantId,
    updatedAt: dataset.updatedAt,
    updatedBy: dataset.admin.uid,
    voidReason: "seeded_reissue",
    voidedAt: addMinutes(dataset.createdAt, -60),
    voidedBy: dataset.admin.uid,
  };
}

function buildPassageDoc({
  credential,
  dataset,
  direction = "entry",
  fromAreaId = "lobby",
  gateId,
  participant,
  reason = "seeded passage",
  result = "allowed",
  scannedAt,
  source = "gate_scan",
  targetAreaId,
  toAreaId = targetAreaId,
}) {
  const passageId = `${source}-${targetAreaId}-${participant.participantId}`;

  return {
    createdAt: scannedAt,
    credentialBadgeId: credential.badgeId,
    credentialId: credential.badgeId,
    deviceId: "seed-mobile-scanner",
    direction,
    eventId: dataset.event.eventId,
    fromAreaId,
    gateId,
    metadata: {
      seeded: true,
    },
    operatorUid: dataset.admin.uid,
    participantId: participant.participantId,
    passageId,
    reason,
    result,
    scannedAt,
    source,
    swoogoRegistrantId: participant.participantId,
    targetAreaId,
    toAreaId,
  };
}

async function ensureAuthUser(auth, options) {
  if (options.skipAuthUser) {
    return {
      created: false,
      displayName: options.adminName,
      email: options.adminEmail,
      skipped: true,
      uid: options.adminUid,
    };
  }

  let userRecord;
  let created = false;

  try {
    userRecord = await auth.getUserByEmail(options.adminEmail);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw error;
    }

    if (!options.adminPassword) {
      throw new Error("SETUP_ADMIN_PASSWORD or --admin-password is required to create the missing admin Auth user.");
    }

    userRecord = await auth.createUser({
      displayName: options.adminName,
      email: options.adminEmail,
      emailVerified: true,
      password: options.adminPassword,
    });
    created = true;
  }

  const existingClaims = userRecord.customClaims || {};
  const globalRoles = unique([
    ...(Array.isArray(existingClaims.globalRoles) ? existingClaims.globalRoles : []),
    ...(Array.isArray(existingClaims.roles) ? existingClaims.roles : []),
    ...GLOBAL_ROLES,
  ]);

  await auth.setCustomUserClaims(userRecord.uid, {
    ...existingClaims,
    globalRoles,
    roles: globalRoles,
    superAdmin: true,
  });

  return {
    created,
    displayName: userRecord.displayName || options.adminName,
    email: userRecord.email || options.adminEmail,
    skipped: false,
    uid: userRecord.uid,
  };
}

async function getActiveCredentialId(eventRef, participant) {
  const snapshot = await eventRef.collection("participants").doc(participant.participantId).get();
  const data = snapshot.exists ? snapshot.data() || {} : {};
  const credentialing = data.credentialing && typeof data.credentialing === "object" ? data.credentialing : {};

  return credentialing.activeBadgeId || credentialing.activeCredentialId || null;
}

async function buildCredentialPlan(eventRef, dataset) {
  const plan = new Map();

  for (const participant of dataset.participants) {
    if (participant.credentialingStatus === "imported") {
      continue;
    }

    const existingCredentialId = await getActiveCredentialId(eventRef, participant);
    const badgeId = existingCredentialId || eventRef.collection("credentials").doc().id;
    const issuedAt = addMinutes(dataset.createdAt, participant.credentialingStatus === "queued" ? 10 : 20);
    const qrPayload = buildCredentialQrPayload(badgeId, issuedAt, participant.participantId);

    plan.set(participant.participantId, {
      badgeId,
      issuedAt,
      printJobId: `badge-${participant.participantId}`,
      qrPayload,
    });
  }

  return plan;
}

function addSet(writes, ref, data, options = { merge: true }) {
  writes.push({
    data,
    options,
    ref,
    type: "set",
  });
}

async function commitWrites(db, writes) {
  const chunkSize = 400;

  for (let index = 0; index < writes.length; index += chunkSize) {
    const batch = db.batch();
    const chunk = writes.slice(index, index + chunkSize);

    for (const write of chunk) {
      if (write.type === "set") {
        batch.set(write.ref, write.data, write.options);
      }
    }

    await batch.commit();
  }
}

function buildDryRunSummary(dataset) {
  const credentialedParticipants = dataset.participants.filter((participant) => participant.credentialingStatus !== "imported");

  return {
    authUser: dataset.admin.email,
    databaseId: FIRESTORE_DATABASE_ID,
    eventId: dataset.event.eventId,
    writes: {
      accessAreaParticipantOverrides: 1,
      accessAreas: dataset.areas.length,
      areaPassages: 3,
      badgeLayouts: 1,
      credentials: credentialedParticipants.length + 1,
      eventDocuments: 1,
      eventMembers: 1,
      gates: dataset.gates.length,
      messageJobs: dataset.participants.length,
      participants: dataset.participants.length,
      printJobs: credentialedParticipants.length,
      queueEntries: credentialedParticipants.length,
      queues: dataset.queues.length,
      registrationTypes: dataset.registrationTypes.length,
      sessions: dataset.sessions.length,
      sessionCheckins: 2,
      terminals: dataset.terminals.length,
      users: 1,
    },
  };
}

async function seedFirestore(options, dependencies = {}) {
  validateOptions(options);

  const dryRunDataset = buildSeedDataset({
    ...options,
    adminUid: options.adminUid || "dry-run-admin",
  });

  if (options.dryRun) {
    return {
      dryRun: true,
      summary: buildDryRunSummary(dryRunDataset),
    };
  }

  const auth = dependencies.auth || getFirebaseAuth();
  const adminUser = await ensureAuthUser(auth, options);
  const dataset = buildSeedDataset({
    ...options,
    adminEmail: adminUser.email,
    adminName: adminUser.displayName,
    adminUid: adminUser.uid,
    updatedAt: new Date(),
  });
  const db = dependencies.db || getFirestoreDb();
  const eventRef = db.collection("events").doc(dataset.event.eventId);
  const credentialPlan = await buildCredentialPlan(eventRef, dataset);
  const writes = [];
  const eventNow = FieldValue.serverTimestamp();

  addSet(writes, db.collection("users").doc(dataset.admin.uid), {
    createdAt: dataset.createdAt,
    createdBy: SEED_SOURCE,
    disabled: false,
    displayName: dataset.admin.displayName,
    email: dataset.admin.email,
    globalRoles: GLOBAL_ROLES,
    status: "active",
    uid: dataset.admin.uid,
    updatedAt: eventNow,
    updatedBy: SEED_SOURCE,
  });

  addSet(writes, eventRef, {
    ...dataset.event,
    createdAt: dataset.createdAt,
    createdBy: dataset.admin.uid,
    registrationEnabledAt: dataset.createdAt,
    registrationEnabledBy: dataset.admin.uid,
    seededAt: eventNow,
    seededBy: SEED_SOURCE,
    updatedAt: eventNow,
    updatedBy: dataset.admin.uid,
  });

  addSet(writes, eventRef.collection("members").doc(dataset.admin.uid), {
    active: true,
    allowedAreaIds: [],
    allowedGateIds: [],
    allowedQueueIds: [],
    allowedSessionIds: [],
    createdAt: dataset.createdAt,
    createdBy: SEED_SOURCE,
    email: dataset.admin.email,
    eventId: dataset.event.eventId,
    name: dataset.admin.displayName,
    roles: EVENT_ROLES,
    scopeModes: {
      areas: "all",
      gates: "all",
      queues: "all",
      sessions: "all",
    },
    status: "active",
    uid: dataset.admin.uid,
    updatedAt: eventNow,
    updatedBy: SEED_SOURCE,
  });

  for (const registrationType of dataset.registrationTypes) {
    addSet(writes, eventRef.collection("registrationTypes").doc(registrationType.registrationTypeId), {
      ...registrationType,
      createdAt: dataset.createdAt,
      createdBy: SEED_SOURCE,
      defaultBadgeLayoutId: DEFAULT_LAYOUT.layoutId,
      eventId: dataset.event.eventId,
      source: "seed",
      status: "active",
      swoogoEventId: dataset.event.swoogo.eventId,
      swoogoRegistrationTypeId: registrationType.registrationTypeId,
      syncedAt: dataset.updatedAt,
      updatedAt: eventNow,
      updatedBy: SEED_SOURCE,
    });
  }

  for (const queue of dataset.queues) {
    addSet(writes, eventRef.collection("queues").doc(queue.queueId), {
      ...queue,
      acceptedRegistrationTypeIds: queue.registrationTypeIds,
      createdAt: dataset.createdAt,
      createdBy: SEED_SOURCE,
      eventId: dataset.event.eventId,
      metrics: {
        delivered: 2,
        lastAssignedAt: dataset.updatedAt,
        pending: queue.queueId === "general" ? 1 : 0,
        printing: 0,
        readyForPickup: queue.queueId === "vip" ? 1 : 0,
      },
      status: "active",
      terminalIds: dataset.terminals
        .filter((terminal) => terminal.queueIds.includes(queue.queueId))
        .map((terminal) => terminal.terminalId),
      updatedAt: eventNow,
      updatedBy: SEED_SOURCE,
    });
  }

  for (const terminal of dataset.terminals) {
    addSet(writes, eventRef.collection("terminals").doc(terminal.terminalId), {
      ...terminal,
      createdAt: dataset.createdAt,
      createdBy: SEED_SOURCE,
      eventId: dataset.event.eventId,
      status: "offline",
      updatedAt: eventNow,
      updatedBy: SEED_SOURCE,
    });
  }

  for (const area of dataset.areas) {
    const accessAreaDoc = {
      allowedBadgeStatuses: ["issued", "delivered"],
      allowedRegistrationTypeIds: area.registrationTypeIds,
      createdAt: dataset.createdAt,
      createdBy: SEED_SOURCE,
      defaultDecision: area.defaultDecision,
      deniedRegistrationTypeIds: [],
      eventId: dataset.event.eventId,
      name: area.name,
      occupancy: {
        currentCount: dataset.participants.filter((participant) => participant.presence?.currentAreaId === area.areaId).length,
        lastRecalculatedAt: dataset.updatedAt,
      },
      participantOverrideMode: "allow_and_deny",
      status: "active",
      type: area.type,
      updatedAt: eventNow,
      updatedBy: SEED_SOURCE,
    };

    addSet(writes, eventRef.collection("areas").doc(area.areaId), {
      areaId: area.areaId,
      createdAt: dataset.createdAt,
      createdBy: SEED_SOURCE,
      eventId: dataset.event.eventId,
      name: area.name,
      registrationTypeIds: area.registrationTypeIds,
      status: "active",
      type: area.type,
      updatedAt: eventNow,
      updatedBy: SEED_SOURCE,
    });
    addSet(writes, eventRef.collection("accessAreas").doc(area.areaId), {
      ...accessAreaDoc,
      areaId: area.areaId,
    });
  }

  for (const gate of dataset.gates) {
    addSet(writes, eventRef.collection("gates").doc(gate.gateId), {
      ...gate,
      allowRepeatedEntry: true,
      createdAt: dataset.createdAt,
      createdBy: SEED_SOURCE,
      denyCancelledCredentials: true,
      eventId: dataset.event.eventId,
      gateId: gate.gateId,
      mode: "entry_only",
      operatorRole: "gate_operator",
      status: "active",
      targetAreaId: gate.areaId,
      updatedAt: eventNow,
      updatedBy: SEED_SOURCE,
    });
  }

  for (const session of dataset.sessions) {
    const area = dataset.areas.find((entry) => entry.areaId === session.areaId);

    addSet(writes, eventRef.collection("sessions").doc(session.sessionId), {
      ...session,
      accessAreaId: session.areaId,
      accessAreaName: area?.name || "",
      createdAt: dataset.createdAt,
      createdBy: SEED_SOURCE,
      enforceAreaPermissionForSessions: true,
      eventId: dataset.event.eventId,
      lastSyncedAt: dataset.updatedAt,
      status: "active",
      swoogoEventId: dataset.event.swoogo.eventId,
      updatedAt: eventNow,
      updatedBy: SEED_SOURCE,
    });
  }

  addSet(writes, eventRef.collection("badgeLayouts").doc(DEFAULT_LAYOUT.layoutId), buildBadgeLayoutDoc({
    ...dataset,
    updatedAt: eventNow,
  }));

  for (const participant of dataset.participants) {
    const credential = credentialPlan.get(participant.participantId);

    addSet(
      writes,
      eventRef.collection("participants").doc(participant.participantId),
      buildParticipantDoc(participant, { ...dataset, updatedAt: eventNow }, credential),
    );

    addSet(writes, eventRef.collection("messageJobs").doc(`confirmation-${participant.participantId}`), {
      attempts: 1,
      channel: "email",
      createdAt: dataset.createdAt,
      eventId: dataset.event.eventId,
      fromEmail: dataset.event.sendgrid.fromEmail,
      fromName: dataset.event.sendgrid.fromName,
      integrationSnapshot: {
        provider: "sendgrid",
        templatePurpose: "confirmation",
      },
      lastError: null,
      messageJobId: `confirmation-${participant.participantId}`,
      participantId: participant.participantId,
      provider: "sendgrid",
      providerMessageId: `seed-${participant.participantId}`,
      qrImageUrl: "",
      qrPayload: credential?.qrPayload || "",
      registrantId: participant.participantId,
      sentAt: addMinutes(dataset.createdAt, 2),
      status: "sent",
      templateId: "",
      templatePurpose: "confirmation",
      to: participant.email,
      updatedAt: eventNow,
    });

    if (!credential) {
      continue;
    }

    addSet(
      writes,
      eventRef.collection("credentials").doc(credential.badgeId),
      buildCredentialDoc(participant, { ...dataset, updatedAt: eventNow }, credential),
    );
    addSet(
      writes,
      eventRef.collection("printJobs").doc(credential.printJobId),
      buildPrintJobDoc(participant, { ...dataset, updatedAt: eventNow }, credential),
    );
    addSet(
      writes,
      eventRef.collection("queueEntries").doc(`seed-${participant.participantId}`),
      buildQueueEntryDoc(participant, { ...dataset, updatedAt: eventNow }, credential),
    );

    if (participant.reissuedCredential) {
      addSet(
        writes,
        eventRef.collection("credentials").doc(`voided-${participant.participantId}-previous`),
        buildVoidedCredentialDoc(participant, { ...dataset, updatedAt: eventNow }, credential),
      );
    }
  }

  const bruno = dataset.participants.find((participant) => participant.participantId === "1002");
  const marina = dataset.participants.find((participant) => participant.participantId === "1005");
  const pedro = dataset.participants.find((participant) => participant.participantId === "1006");
  const brunoCredential = bruno ? credentialPlan.get(bruno.participantId) : null;
  const marinaCredential = marina ? credentialPlan.get(marina.participantId) : null;
  const pedroCredential = pedro ? credentialPlan.get(pedro.participantId) : null;

  if (bruno && brunoCredential) {
    const sessionCheckinId = "opening-keynote_1002";
    const passage = buildPassageDoc({
      credential: brunoCredential,
      dataset,
      fromAreaId: "lobby",
      gateId: "auditorium-1-door",
      participant: bruno,
      reason: "Opening keynote check-in",
      scannedAt: addMinutes(dataset.createdAt, 60),
      source: "session_checkin",
      targetAreaId: "auditorium-1",
    });

    addSet(writes, eventRef.collection("sessionCheckins").doc(sessionCheckinId), {
      accessAreaId: "auditorium-1",
      areaPassageId: passage.passageId,
      checkedInAt: passage.scannedAt,
      createdAt: passage.scannedAt,
      credentialBadgeId: brunoCredential.badgeId,
      credentialId: brunoCredential.badgeId,
      deviceId: "seed-mobile-scanner",
      eventId: dataset.event.eventId,
      operatorUid: dataset.admin.uid,
      participantId: bruno.participantId,
      registrantId: bruno.participantId,
      sessionCheckinId,
      sessionId: "opening-keynote",
      status: "synced",
      swoogoScanId: "seed-swoogo-scan-1002",
      syncedAt: addMinutes(dataset.createdAt, 61),
      updatedAt: eventNow,
    });
    addSet(writes, eventRef.collection("areaPassages").doc(passage.passageId), passage);
    addSet(writes, eventRef.collection("participants").doc(bruno.participantId).collection("accessPassages").doc(passage.passageId), passage);
  }

  if (marina && marinaCredential) {
    const sessionCheckinId = "vip-roundtable_1005";
    const passage = buildPassageDoc({
      credential: marinaCredential,
      dataset,
      fromAreaId: "lobby",
      gateId: "vip-lounge-door",
      participant: marina,
      reason: "VIP access granted by registration type",
      scannedAt: addMinutes(dataset.createdAt, 80),
      source: "session_checkin",
      targetAreaId: "vip-lounge",
    });

    addSet(writes, eventRef.collection("sessionCheckins").doc(sessionCheckinId), {
      accessAreaId: "vip-lounge",
      areaPassageId: passage.passageId,
      checkedInAt: passage.scannedAt,
      createdAt: passage.scannedAt,
      credentialBadgeId: marinaCredential.badgeId,
      credentialId: marinaCredential.badgeId,
      deviceId: "seed-mobile-scanner",
      eventId: dataset.event.eventId,
      operatorUid: dataset.admin.uid,
      participantId: marina.participantId,
      registrantId: marina.participantId,
      sessionCheckinId,
      sessionId: "vip-roundtable",
      status: "synced",
      swoogoScanId: "seed-swoogo-scan-1005",
      syncedAt: addMinutes(dataset.createdAt, 81),
      updatedAt: eventNow,
    });
    addSet(writes, eventRef.collection("areaPassages").doc(passage.passageId), passage);
    addSet(writes, eventRef.collection("participants").doc(marina.participantId).collection("accessPassages").doc(passage.passageId), passage);
  }

  if (pedro && pedroCredential) {
    const deniedPassage = buildPassageDoc({
      credential: pedroCredential,
      dataset,
      fromAreaId: "lobby",
      gateId: "vip-lounge-door",
      participant: pedro,
      reason: "Registration type is not allowed for this area",
      result: "denied",
      scannedAt: addMinutes(dataset.createdAt, 85),
      targetAreaId: "vip-lounge",
      toAreaId: "lobby",
    });

    addSet(writes, eventRef.collection("areaPassages").doc(deniedPassage.passageId), deniedPassage);
    addSet(writes, eventRef.collection("participants").doc(pedro.participantId).collection("accessPassages").doc(deniedPassage.passageId), deniedPassage);
  }

  addSet(writes, eventRef.collection("accessAreas").doc("vip-lounge").collection("participantOverrides").doc("1003"), {
    areaId: "vip-lounge",
    createdAt: dataset.createdAt,
    createdBy: dataset.admin.uid,
    decision: "allow",
    eventId: dataset.event.eventId,
    participantId: "1003",
    reason: "Speaker has VIP lounge access for backstage coordination.",
    updatedAt: eventNow,
    updatedBy: dataset.admin.uid,
    validFrom: dataset.createdAt,
    validUntil: null,
  });

  await commitWrites(db, writes);

  return {
    adminUser,
    dryRun: false,
    eventId: dataset.event.eventId,
    summary: {
      ...buildDryRunSummary(dataset),
      writes: {
        total: writes.length,
      },
    },
  };
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(usageText());
    return;
  }

  const result = await seedFirestore(options);

  if (result.dryRun) {
    console.log(JSON.stringify(result.summary, null, 2));
    return;
  }

  console.log(JSON.stringify({
    adminUser: {
      created: result.adminUser.created,
      email: result.adminUser.email,
      skipped: result.adminUser.skipped,
      uid: result.adminUser.uid,
    },
    databaseId: FIRESTORE_DATABASE_ID,
    eventId: result.eventId,
    status: "seeded",
    writes: result.summary.writes.total,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      error: {
        code: error.code || "setup_firestore_failed",
        message: error.message,
        name: error.name || "Error",
      },
    }));
    process.exitCode = 1;
  });
}

module.exports = {
  buildCredentialQrPayload,
  buildDryRunSummary,
  buildSeedDataset,
  parseArgs,
  seedFirestore,
  usageText,
};
