"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TERMINAL_IDENTITY_PATH = path.join(
  os.homedir(),
  ".config",
  "swoogo-selfcheckin",
  "print-terminal.json"
);

function normalizeTerminalIdentity(identity = {}) {
  const terminalId = identity.terminalId ? String(identity.terminalId).trim() : null;
  const terminalName = identity.terminalName ? String(identity.terminalName).trim() : null;

  return {
    terminalId,
    terminalName: terminalName || terminalId,
  };
}

function readTerminalIdentity(identityPath) {
  if (!identityPath || !fs.existsSync(identityPath)) {
    return {};
  }

  const raw = fs.readFileSync(identityPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return normalizeTerminalIdentity(parsed);
}

function writeTerminalIdentity(identityPath, identity) {
  const normalized = normalizeTerminalIdentity(identity);

  if (!normalized.terminalId) {
    return normalized;
  }

  fs.mkdirSync(path.dirname(identityPath), { recursive: true });

  const payload = {
    savedAt: new Date().toISOString(),
    terminalId: normalized.terminalId,
    terminalName: normalized.terminalName,
  };
  const tmpPath = `${identityPath}.tmp`;

  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tmpPath, identityPath);

  return payload;
}

module.exports = {
  DEFAULT_TERMINAL_IDENTITY_PATH,
  normalizeTerminalIdentity,
  readTerminalIdentity,
  writeTerminalIdentity,
};
