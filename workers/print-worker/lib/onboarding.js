"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { FieldValue } = require("firebase-admin/firestore");

const { getFirestoreDb } = require("../../../src/api/firebase-admin");
const { ConfigError, normalizeConfig } = require("./config");

const execFileAsync = promisify(execFile);

const DEFAULT_PRINT_WORKER_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "swoogo-selfcheckin",
  "print-worker-config.json"
);

function slugify(value, fallback = "print-terminal") {
  const slug = String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || fallback;
}

function readSavedConfig(configPath = DEFAULT_PRINT_WORKER_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function writeSavedConfig(config, configPath = DEFAULT_PRINT_WORKER_CONFIG_PATH) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  const payload = {
    ...config,
    savedAt: new Date().toISOString(),
  };
  const tmpPath = `${configPath}.tmp`;

  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tmpPath, configPath);

  return payload;
}

async function listFirestoreEvents() {
  const db = getFirestoreDb();
  const snapshot = await db.collection("events").where("registration", "==", true).get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        id: data.eventId || doc.id,
        name: data.name || data.eventId || doc.id,
        status: data.status || "draft",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function registerTerminal(config) {
  const db = getFirestoreDb();
  const terminalRef = db
    .collection("events")
    .doc(config.eventId)
    .collection("terminals")
    .doc(config.terminalId);

  await terminalRef.set({
    createdAt: FieldValue.serverTimestamp(),
    createdBy: "print-worker-onboarding",
    lastHeartbeatAt: FieldValue.serverTimestamp(),
    name: config.terminalName,
    printer: {
      name: config.printerName,
      type: config.printerType,
    },
    queueIds: config.queueIds || [],
    status: "offline",
    terminalId: config.terminalId,
    type: "print",
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: "print-worker-onboarding",
  }, { merge: true });
}

async function getTerminalRegistrationStatus(config) {
  const db = getFirestoreDb();
  const eventRef = db.collection("events").doc(config.eventId);
  const eventSnapshot = await eventRef.get();

  if (!eventSnapshot.exists) {
    return {
      eventExists: false,
      terminalExists: false,
    };
  }

  const terminalSnapshot = await eventRef
    .collection("terminals")
    .doc(config.terminalId)
    .get();

  return {
    eventExists: true,
    terminalExists: terminalSnapshot.exists,
  };
}

async function askRequired(rl, label, fallback = "") {
  while (true) {
    const suffix = fallback ? ` (${fallback})` : "";
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    const value = answer || fallback;

    if (value) {
      return value;
    }
  }
}

async function askChoice(rl, label, options) {
  if (options.length === 0) {
    return null;
  }

  if (options.length === 1) {
    return options[0];
  }

  process.stdout.write(`\n${label}\n`);
  options.forEach((option, index) => {
    process.stdout.write(`  ${index + 1}. ${option.label}\n`);
  });

  while (true) {
    const answer = (await rl.question("Choose an option: ")).trim();
    const index = Number(answer) - 1;

    if (Number.isInteger(index) && options[index]) {
      return options[index];
    }
  }
}

async function listBrotherPrinters() {
  try {
    const { stdout } = await execFileAsync("lpstat", ["-e"], { timeout: 5000 });
    return stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  } catch {
    try {
      const { stdout } = await execFileAsync("lpstat", ["-p"], { timeout: 5000 });
      return stdout
        .split(/\r?\n/)
        .map((line) => line.match(/^printer\s+(\S+)/)?.[1])
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}

function parseDymoPrinterNames(xml) {
  const names = [];
  const matcher = /<Name>([^<]+)<\/Name>/g;
  let match = matcher.exec(xml);

  while (match) {
    names.push(match[1].trim());
    match = matcher.exec(xml);
  }

  return Array.from(new Set(names)).filter(Boolean);
}

async function listDymoPrinters() {
  if (typeof fetch !== "function") {
    return [];
  }

  const urls = [
    "http://127.0.0.1:41951/DYMO/DLS/Printing/GetPrinters",
    "http://localhost:41951/DYMO/DLS/Printing/GetPrinters",
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }

      return parseDymoPrinterNames(await response.text());
    } catch {
      // Try the next local DYMO endpoint.
    }
  }

  return [];
}

async function choosePrinter(rl, printerType) {
  const printerNames = printerType === "dymo"
    ? await listDymoPrinters()
    : await listBrotherPrinters();
  const choice = await askChoice(
    rl,
    printerType === "dymo" ? "DYMO printers detected" : "System printers detected",
    printerNames.map((printerName) => ({ label: printerName, value: printerName }))
  );

  if (choice) {
    return choice.value;
  }

  return askRequired(rl, "Printer name");
}

async function createInteractiveConfig(options = {}) {
  const configPath = options.configPath || DEFAULT_PRINT_WORKER_CONFIG_PATH;
  const mode = options.mode || "watch";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const events = await listFirestoreEvents();
    if (events.length === 0) {
      throw new Error("No credentialing events were found in Firestore.");
    }

    const eventChoice = await askChoice(
      rl,
      "Credentialing events",
      events.map((event) => ({
        label: `${event.name} (${event.id}, ${event.status})`,
        value: event,
      }))
    );
    const terminalName = await askRequired(rl, "Terminal name", `${os.hostname()} print terminal`);
    const printerTypeChoice = await askChoice(rl, "Printer type", [
      { label: "Brother QL-800", value: "brother-ql-800" },
      { label: "DYMO 650", value: "dymo" },
    ]);
    const printerName = await choosePrinter(rl, printerTypeChoice.value);
    const apiBaseUrl = await askRequired(rl, "API base URL", "http://127.0.0.1:3000");
    const terminalId = slugify(`${eventChoice.value.id}-${terminalName}-${os.hostname()}`);
    const config = {
      allowSpoolerExecution: true,
      apiBaseUrl,
      eventId: eventChoice.value.id,
      mode,
      printerName,
      printerType: printerTypeChoice.value,
      queueIds: [],
      terminalId,
      terminalName,
    };

    writeSavedConfig(config, configPath);
    await registerTerminal(config);

    process.stdout.write(`Saved print worker config to ${configPath}\n`);
    return config;
  } finally {
    rl.close();
  }
}

async function loadOrCreateInteractiveConfig(options = {}) {
  const cwd = options.cwd || process.cwd();
  const configPath = options.configPath || DEFAULT_PRINT_WORKER_CONFIG_PATH;
  const savedConfig = readSavedConfig(configPath);
  const overrides = {
    ...(options.mode ? { mode: options.mode } : {}),
  };

  if (savedConfig) {
    try {
      return normalizeConfig({ ...savedConfig, ...overrides }, cwd);
    } catch (error) {
      if (!(error instanceof ConfigError) || !Array.isArray(error.details?.missing)) {
        throw error;
      }

      process.stdout.write(`Saved print worker config is incomplete. Starting setup again.\n`);
    }
  }

  const createdConfig = await createInteractiveConfig({ configPath, mode: options.mode });
  return normalizeConfig({ ...createdConfig, ...overrides }, cwd);
}

async function ensureTerminalRegistration(config, options = {}) {
  if (config.mode === "dry-run") {
    return config;
  }

  const cwd = options.cwd || process.cwd();
  const configPath = options.configPath || config.configPath || DEFAULT_PRINT_WORKER_CONFIG_PATH;
  const mode = options.mode || config.mode || "watch";
  const status = options.registrationStatus
    ? await options.registrationStatus(config)
    : await getTerminalRegistrationStatus(config);

  if (status.terminalExists) {
    return config;
  }

  const canAsk = options.interactive ?? process.stdin.isTTY;
  if (!canAsk) {
    throw new ConfigError("Print worker terminal is not registered in Firestore.", {
      eventExists: status.eventExists,
      eventId: config.eventId,
      terminalId: config.terminalId,
      terminalName: config.terminalName,
    });
  }

  if (!status.eventExists) {
    process.stdout.write(
      `Event "${config.eventId}" is not registered in Firestore. Starting setup from scratch.\n`
    );
    const createdConfig = await createInteractiveConfig({ configPath, mode });
    return normalizeConfig(createdConfig, cwd);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    process.stdout.write(
      `Terminal "${config.terminalName}" (${config.terminalId}) is not registered for event "${config.eventId}".\n`
    );
    const choice = await askChoice(rl, "How do you want to continue?", [
      { label: "Re-register this terminal with the current local data", value: "reregister" },
      { label: "Start a new terminal setup from scratch", value: "reset" },
    ]);

    if (choice?.value === "reregister") {
      await registerTerminal(config);
      writeSavedConfig({ ...config, mode }, configPath);
      process.stdout.write(`Terminal "${config.terminalName}" registered again.\n`);
      return normalizeConfig({ ...config, mode }, cwd);
    }
  } finally {
    rl.close();
  }

  const createdConfig = await createInteractiveConfig({ configPath, mode });
  return normalizeConfig(createdConfig, cwd);
}

module.exports = {
  DEFAULT_PRINT_WORKER_CONFIG_PATH,
  createInteractiveConfig,
  ensureTerminalRegistration,
  getTerminalRegistrationStatus,
  listBrotherPrinters,
  listDymoPrinters,
  loadOrCreateInteractiveConfig,
  readSavedConfig,
  writeSavedConfig,
};
