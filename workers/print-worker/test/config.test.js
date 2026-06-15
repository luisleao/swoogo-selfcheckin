"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ConfigError, loadConfig } = require("../lib/config");
const { ensureTerminalRegistration, loadOrCreateInteractiveConfig, writeSavedConfig } = require("../lib/onboarding");

test("dry-run mode supplies local defaults without backend credentials", () => {
  const config = loadConfig({
    argv: [],
    env: {},
    cwd: process.cwd(),
  });

  assert.equal(config.mode, "dry-run");
  assert.equal(config.terminalId, "dry-run-terminal");
  assert.equal(config.terminalName, "Dry-run terminal");
  assert.equal(config.printerName, "dry-run-printer");
  assert.equal(config.allowSpoolerExecution, false);
});

test("non-dry-run mode fails fast when required configuration is missing", () => {
  assert.throws(
    () =>
      loadConfig({
        argv: ["--mode=once"],
        env: {},
        cwd: process.cwd(),
      }),
    ConfigError
  );
});

test("loads optional JSON config and lets env override it", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "print-worker-config-"));
  const configPath = path.join(tmpDir, "worker.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({
      mode: "dry-run",
      printerName: "file-printer",
      queueIds: ["vip"],
    })}\n`
  );

  const config = loadConfig({
    argv: [`--config=${configPath}`],
    env: {
      PRINTER_NAME: "env-printer",
      QUEUE_IDS: "vip,default",
    },
    cwd: process.cwd(),
  });

  assert.equal(config.printerName, "env-printer");
  assert.deepEqual(config.queueIds, ["vip", "default"]);
});

test("saves terminal identity from execution arguments and reuses it locally", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "print-worker-terminal-"));
  const terminalConfigPath = path.join(tmpDir, "terminal.json");

  const enrolledConfig = loadConfig({
    argv: [
      "--mode=dry-run",
      `--terminal-config=${terminalConfigPath}`,
      "--terminal-id=printer-mac-01",
      "--terminal-name=Printer Mac 01",
    ],
    env: {},
    cwd: process.cwd(),
  });

  assert.equal(enrolledConfig.terminalId, "printer-mac-01");
  assert.equal(enrolledConfig.terminalName, "Printer Mac 01");
  assert.equal(fs.existsSync(terminalConfigPath), true);

  const savedIdentity = JSON.parse(fs.readFileSync(terminalConfigPath, "utf8"));
  assert.equal(savedIdentity.terminalId, "printer-mac-01");
  assert.equal(savedIdentity.terminalName, "Printer Mac 01");

  const reusedConfig = loadConfig({
    argv: [`--terminal-config=${terminalConfigPath}`],
    env: {},
    cwd: process.cwd(),
  });

  assert.equal(reusedConfig.terminalId, "printer-mac-01");
  assert.equal(reusedConfig.terminalName, "Printer Mac 01");
});

test("non-dry-run accepts a locally saved terminal identity", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "print-worker-terminal-"));
  const terminalConfigPath = path.join(tmpDir, "terminal.json");
  fs.writeFileSync(
    terminalConfigPath,
    `${JSON.stringify({
      terminalId: "printer-mac-02",
      terminalName: "Printer Mac 02",
    })}\n`
  );

  const config = loadConfig({
    argv: [`--terminal-config=${terminalConfigPath}`, "--mode=once"],
    env: {
      API_BASE_URL: "http://localhost:3000",
      PRINTER_NAME: "Brother_QL_800_Badges",
    },
    cwd: process.cwd(),
  });

  assert.equal(config.terminalId, "printer-mac-02");
  assert.equal(config.terminalName, "Printer Mac 02");
  assert.equal(config.apiBaseUrl, "http://localhost:3000");
  assert.equal(config.printerName, "Brother_QL_800_Badges");
});

test("interactive saved print worker config can be reused with requested mode", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "print-worker-saved-config-"));
  const configPath = path.join(tmpDir, "print-worker.json");

  writeSavedConfig(
    {
      allowSpoolerExecution: true,
      apiBaseUrl: "http://localhost:3000",
      eventId: "twilio-assemble-sao-paulo",
      mode: "watch",
      printerName: "Brother_QL_800_Badges",
      printerType: "brother-ql-800",
      queueIds: [],
      terminalId: "twilio-assemble-sao-paulo-print-terminal",
      terminalName: "Print terminal",
    },
    configPath
  );

  const config = await loadOrCreateInteractiveConfig({
    configPath,
    cwd: process.cwd(),
    mode: "once",
  });

  assert.equal(config.mode, "once");
  assert.equal(config.eventId, "twilio-assemble-sao-paulo");
  assert.equal(config.terminalName, "Print terminal");
  assert.equal(config.printerName, "Brother_QL_800_Badges");
});

test("noninteractive worker reports when saved terminal is no longer registered", async () => {
  await assert.rejects(
    () =>
      ensureTerminalRegistration(
        {
          apiBaseUrl: "http://localhost:3000",
          eventId: "twilio-assemble-sao-paulo",
          mode: "watch",
          printerName: "Brother_QL_800_Badges",
          terminalId: "removed-terminal",
          terminalName: "Removed terminal",
        },
        {
          interactive: false,
          registrationStatus: async () => ({
            eventExists: true,
            terminalExists: false,
          }),
        }
      ),
    (error) => {
      assert.equal(error instanceof ConfigError, true);
      assert.equal(error.message, "Print worker terminal is not registered in Firestore.");
      assert.equal(error.details.terminalId, "removed-terminal");
      return true;
    }
  );
});

test("does not read terminal identity from environment variables", () => {
  const config = loadConfig({
    argv: ["--mode=dry-run"],
    env: {
      TERMINAL_ID: "env-terminal",
    },
    cwd: process.cwd(),
  });

  assert.equal(config.terminalId, "dry-run-terminal");
});
