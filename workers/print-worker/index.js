#!/usr/bin/env node
"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), quiet: true });

const { ConfigError, loadConfig, parseArgs } = require("./lib/config");
const { ensureTerminalRegistration, loadOrCreateInteractiveConfig } = require("./lib/onboarding");
const { runWorker } = require("./lib/worker");

function printHelp() {
  process.stdout.write(`Swoogo print worker scaffold

Usage:
  node workers/print-worker/index.js [--mode=dry-run|once|watch] [--config=path/to/config.json]

Common options:
  --dry-run              Alias for --mode=dry-run.
  --event-id=SLUG        Firestore event slug for direct print job claiming.
  --fixture=PATH         Dry-run print job JSON fixture.
  --output-dir=PATH      Directory for dry-run render artifacts.
  --printer=NAME         Printer queue name used in generated spool commands.
  --terminal-id=ID       Saves the local terminal identity for this machine.
  --terminal-name=NAME   Saves the operator-facing terminal name.
  --terminal-config=PATH Local terminal identity file.

Without arguments, the worker runs first-time setup: it lists Firestore events,
registers this terminal, detects printers, saves local config, and starts the worker.
Dry-run is the default mode when using explicit arguments without --mode.
`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const argv = process.argv.slice(2);
  const cliConfig = parseArgs(argv);
  const hasArguments = argv.length > 0;
  let config;

  if (!hasArguments) {
    config = await loadOrCreateInteractiveConfig({ mode: "watch" });
  } else {
    try {
      config = loadConfig();
    } catch (error) {
      const mode = String(cliConfig.mode || "").toLowerCase();
      const canRunInteractiveSetup =
        error instanceof ConfigError &&
        Array.isArray(error.details?.missing) &&
        ["once", "watch"].includes(mode) &&
        !cliConfig.configPath;

      if (!canRunInteractiveSetup) {
        throw error;
      }

      config = await loadOrCreateInteractiveConfig({ mode });
    }
  }

  config = await ensureTerminalRegistration(config, {
    configPath: cliConfig.configPath || config.configPath,
    mode: config.mode,
  });

  const result = await runWorker(config);

  if (result && result.status) {
    process.stdout.write(
      `${JSON.stringify({
        status: result.status,
        artifact: result.artifact,
        spoolerDryRun: result.spoolResult && result.spoolResult.dryRun,
      })}\n`
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    const isConfigError = error instanceof ConfigError || error.name === "ConfigError";
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code: error.code || (isConfigError ? "invalid_print_worker_config" : "print_worker_error"),
          details: error.details,
          message: error.message,
          name: error.name,
        },
      })}\n`
    );
    process.exitCode = isConfigError ? 2 : 1;
  });
}

module.exports = {
  main,
};
