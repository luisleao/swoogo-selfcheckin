"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_TERMINAL_IDENTITY_PATH,
  readTerminalIdentity,
  writeTerminalIdentity,
} = require("./terminal-identity");

class ConfigError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ConfigError";
    this.code = "invalid_print_worker_config";
    this.details = details;
  }
}

const WORKER_ROOT = path.resolve(__dirname, "..");

const DEFAULT_CONFIG = {
  apiBaseUrl: null,
  allowSpoolerExecution: false,
  badgeRenderTmpDir: path.join(os.tmpdir(), "swoogo-print-worker"),
  claimPollIntervalMs: 1000,
  copies: 1,
  dryRunFixturePath: path.join(WORKER_ROOT, "fixtures", "sample-print-job.json"),
  eventId: null,
  heartbeatIntervalMs: 30000,
  logLevel: "info",
  maxPrintAttempts: 3,
  mode: "dry-run",
  platform: process.platform,
  printMedia: "Custom.62x100mm",
  printOutputFormat: "pdf",
  printerName: null,
  printerType: "brother-ql-800",
  queueIds: [],
  spooler: "cups",
  terminalIdentityPath: DEFAULT_TERMINAL_IDENTITY_PATH,
  terminalId: null,
  terminalName: null,
  terminalTokenPath: null,
  terminalUi: "on",
  printingTimeoutSeconds: 180,
};

const ENV_TO_CONFIG_KEY = {
  API_BASE_URL: "apiBaseUrl",
  BADGE_RENDER_TMP_DIR: "badgeRenderTmpDir",
  CLAIM_POLL_INTERVAL_MS: "claimPollIntervalMs",
  HEARTBEAT_INTERVAL_MS: "heartbeatIntervalMs",
  LOG_LEVEL: "logLevel",
  MAX_PRINT_ATTEMPTS: "maxPrintAttempts",
  PRINT_MEDIA: "printMedia",
  PRINT_OUTPUT_FORMAT: "printOutputFormat",
  PRINTER_NAME: "printerName",
  PRINTER_TYPE: "printerType",
  PRINT_WORKER_ALLOW_SPOOL: "allowSpoolerExecution",
  PRINT_WORKER_CONFIG: "configPath",
  PRINT_WORKER_DRY_RUN_FIXTURE: "dryRunFixturePath",
  PRINTING_TIMEOUT_SECONDS: "printingTimeoutSeconds",
  QUEUE_IDS: "queueIds",
  SPOOLER: "spooler",
  TERMINAL_TOKEN_PATH: "terminalTokenPath",
  PRINT_WORKER_UI: "terminalUi",
  WORKER_MODE: "mode",
};

function parseArgs(argv) {
  const parsed = {};

  for (const arg of argv) {
    if (arg === "--dry-run") {
      parsed.mode = "dry-run";
      continue;
    }

    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, ...rawValueParts] = arg.slice(2).split("=");
    const value = rawValueParts.length > 0 ? rawValueParts.join("=") : "true";

    if (rawKey === "config") {
      parsed.configPath = value;
    } else if (rawKey === "fixture") {
      parsed.dryRunFixturePath = value;
    } else if (rawKey === "event-id") {
      parsed.eventId = value;
    } else if (rawKey === "mode") {
      parsed.mode = value;
    } else if (rawKey === "output-dir") {
      parsed.badgeRenderTmpDir = value;
    } else if (rawKey === "printer") {
      parsed.printerName = value;
    } else if (rawKey === "terminal-config") {
      parsed.terminalIdentityPath = value;
    } else if (rawKey === "terminal-id") {
      parsed.terminalId = value;
    } else if (rawKey === "terminal-name") {
      parsed.terminalName = value;
    } else if (rawKey === "ui") {
      parsed.terminalUi = value === "true" ? "on" : value;
    } else if (rawKey === "no-ui") {
      parsed.terminalUi = "off";
    }
  }

  return parsed;
}

function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return Boolean(value);
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function normalizeTerminalUi(value) {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_CONFIG.terminalUi;
  }

  if (typeof value === "boolean") {
    return value ? "on" : "off";
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return "on";
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return "off";
  }

  if (normalized === "auto") {
    return "auto";
  }

  throw new ConfigError("PRINT_WORKER_UI must be on, off, or auto.", {
    terminalUi: value,
  });
}

function parseInteger(value, label) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ConfigError(`${label} must be a non-negative integer.`, { value });
  }

  return parsed;
}

function normalizeQueueIds(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readConfigFile(configPath, cwd) {
  if (!configPath) {
    return {};
  }

  const resolvedPath = path.resolve(cwd, configPath);
  let raw;
  try {
    raw = fs.readFileSync(resolvedPath, "utf8");
  } catch (error) {
    throw new ConfigError("Unable to read print worker config file.", {
      configPath: resolvedPath,
      cause: error.message,
    });
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Config JSON root must be an object.");
    }

    return parsed;
  } catch (error) {
    throw new ConfigError("Print worker config file must contain JSON object data.", {
      configPath: resolvedPath,
      cause: error.message,
    });
  }
}

function readEnv(env) {
  const config = {};

  for (const [envKey, configKey] of Object.entries(ENV_TO_CONFIG_KEY)) {
    if (Object.prototype.hasOwnProperty.call(env, envKey) && env[envKey] !== "") {
      config[configKey] = env[envKey];
    }
  }

  return config;
}

function normalizeConfig(config, cwd) {
  const normalized = {
    ...config,
    mode: String(config.mode || "dry-run").toLowerCase(),
    printOutputFormat: String(config.printOutputFormat || "pdf").toLowerCase(),
    printerType: String(config.printerType || "brother-ql-800").toLowerCase(),
    spooler: String(config.spooler || "cups").toLowerCase(),
  };

  normalized.allowSpoolerExecution = parseBoolean(normalized.allowSpoolerExecution);
  normalized.terminalUi = normalizeTerminalUi(normalized.terminalUi);
  normalized.claimPollIntervalMs =
    parseInteger(normalized.claimPollIntervalMs, "claimPollIntervalMs") ??
    DEFAULT_CONFIG.claimPollIntervalMs;
  normalized.copies = parseInteger(normalized.copies, "copies") ?? DEFAULT_CONFIG.copies;
  normalized.heartbeatIntervalMs =
    parseInteger(normalized.heartbeatIntervalMs, "heartbeatIntervalMs") ??
    DEFAULT_CONFIG.heartbeatIntervalMs;
  normalized.maxPrintAttempts =
    parseInteger(normalized.maxPrintAttempts, "maxPrintAttempts") ??
    DEFAULT_CONFIG.maxPrintAttempts;
  normalized.printingTimeoutSeconds =
    parseInteger(normalized.printingTimeoutSeconds, "printingTimeoutSeconds") ??
    DEFAULT_CONFIG.printingTimeoutSeconds;
  normalized.queueIds = normalizeQueueIds(normalized.queueIds);

  for (const key of ["badgeRenderTmpDir", "dryRunFixturePath", "terminalIdentityPath", "terminalTokenPath"]) {
    if (normalized[key]) {
      normalized[key] = path.resolve(cwd, normalized[key]);
    }
  }

  if (!["dry-run", "once", "watch"].includes(normalized.mode)) {
    throw new ConfigError("WORKER_MODE must be dry-run, once, or watch.", {
      mode: normalized.mode,
    });
  }

  if (!["pdf", "png"].includes(normalized.printOutputFormat)) {
    throw new ConfigError("PRINT_OUTPUT_FORMAT must be pdf or png.", {
      printOutputFormat: normalized.printOutputFormat,
    });
  }

  if (normalized.spooler !== "cups") {
    throw new ConfigError("Only the CUPS/macOS lp spooler is scaffolded in this slice.", {
      spooler: normalized.spooler,
    });
  }

  if (normalized.mode === "dry-run") {
    normalized.terminalId = normalized.terminalId || "dry-run-terminal";
    normalized.terminalName = normalized.terminalName || "Dry-run terminal";
    normalized.printerName = normalized.printerName || "dry-run-printer";
    return normalized;
  }

  normalized.terminalName = normalized.terminalName || normalized.terminalId;

  const missing = [];
  for (const key of ["terminalId", "apiBaseUrl", "printerName"]) {
    if (!normalized[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new ConfigError("Missing required print worker configuration.", { missing });
  }

  return normalized;
}

function loadConfig(options = {}) {
  const env = options.env || process.env;
  const argv = options.argv || process.argv.slice(2);
  const cwd = options.cwd || process.cwd();
  const cliConfig = parseArgs(argv);
  const envConfig = readEnv(env);
  const configPath = cliConfig.configPath || envConfig.configPath;
  const fileConfig = readConfigFile(configPath, cwd);
  const terminalIdentityPath = path.resolve(
    cwd,
    cliConfig.terminalIdentityPath ||
      fileConfig.terminalIdentityPath ||
      DEFAULT_CONFIG.terminalIdentityPath
  );
  const terminalIdentity = readTerminalIdentity(terminalIdentityPath);
  const hasCliTerminalIdentity = Boolean(cliConfig.terminalId || cliConfig.terminalName);

  const config = normalizeConfig(
    {
      ...DEFAULT_CONFIG,
      ...fileConfig,
      ...terminalIdentity,
      ...envConfig,
      ...cliConfig,
      terminalIdentityPath,
    },
    cwd
  );

  if (hasCliTerminalIdentity) {
    writeTerminalIdentity(config.terminalIdentityPath, {
      terminalId: config.terminalId,
      terminalName: config.terminalName,
    });
  }

  return config;
}

function getPublicConfig(config) {
  return {
    apiBaseUrl: config.apiBaseUrl,
    allowSpoolerExecution: config.allowSpoolerExecution,
    badgeRenderTmpDir: config.badgeRenderTmpDir,
    claimPollIntervalMs: config.claimPollIntervalMs,
    eventId: config.eventId,
    logLevel: config.logLevel,
    mode: config.mode,
    printMedia: config.printMedia,
    printOutputFormat: config.printOutputFormat,
    printerName: config.printerName,
    printerType: config.printerType,
    queueIds: config.queueIds,
    spooler: config.spooler,
    terminalId: config.terminalId,
    terminalName: config.terminalName,
    terminalUi: config.terminalUi,
  };
}

module.exports = {
  ConfigError,
  DEFAULT_CONFIG,
  getPublicConfig,
  loadConfig,
  normalizeConfig,
  parseArgs,
};
