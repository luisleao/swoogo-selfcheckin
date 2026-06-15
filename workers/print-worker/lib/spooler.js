"use strict";

const { spawn } = require("node:child_process");

class SpoolerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SpoolerError";
    this.code = details.code || "spooler_error";
    this.details = details;
  }
}

function quoteForDisplay(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) {
    return text;
  }

  return `'${text.replace(/'/g, "'\\''")}'`;
}

function commandForDisplay(command, args) {
  return [command, ...args].map(quoteForDisplay).join(" ");
}

function buildSpoolCommand(options) {
  const {
    copies = 1,
    filePath,
    media = "Custom.62x100mm",
    printerName,
    printerType = "brother-ql-800",
    spooler = "cups",
  } = options;

  if (!printerName) {
    throw new SpoolerError("PRINTER_NAME is required to build a spool command.", {
      code: "printer_unavailable",
    });
  }

  if (!filePath) {
    throw new SpoolerError("A rendered badge file path is required to build a spool command.", {
      code: "render_missing",
    });
  }

  if (spooler !== "cups") {
    throw new SpoolerError("Only CUPS/macOS lp spooler commands are scaffolded.", {
      code: "unsupported_spooler",
      spooler,
    });
  }

  const args = ["-d", printerName, "-o", `media=${media}`];

  if (Number(copies) > 1) {
    args.push("-n", String(copies));
  }

  args.push(filePath);

  const warnings = [];
  if (printerType === "dymo") {
    warnings.push("DYMO is intentionally marked as later validation; use Brother QL-800 first.");
  } else if (printerType !== "brother-ql-800") {
    warnings.push(`Printer type ${printerType} is not validated by this scaffold.`);
  }

  return {
    args,
    command: "lp",
    display: commandForDisplay("lp", args),
    printerType,
    spooler,
    warnings,
  };
}

function buildDiagnosticsCommands(printerName) {
  if (!printerName) {
    throw new SpoolerError("PRINTER_NAME is required for diagnostics.", {
      code: "printer_unavailable",
    });
  }

  return [
    {
      label: "queue-details",
      command: "lpstat",
      args: ["-p", printerName, "-l"],
    },
    {
      label: "accepting-jobs",
      command: "lpstat",
      args: ["-a", printerName],
    },
    {
      label: "default-options",
      command: "lpoptions",
      args: ["-p", printerName, "-l"],
    },
  ].map((entry) => ({
    ...entry,
    display: commandForDisplay(entry.command, entry.args),
  }));
}

function executeCommand(command, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new SpoolerError("Spooler command timed out.", {
          code: "timeout",
          command,
          args,
          timeoutMs,
        })
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(
        new SpoolerError("Unable to start spooler command.", {
          code: "printer_unavailable",
          command,
          args,
          cause: error.message,
        })
      );
    });

    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      if (exitCode !== 0) {
        reject(
          new SpoolerError("Spooler rejected the print job.", {
            code: "spool_rejected",
            command,
            args,
            exitCode,
            stderr: stderr.trim(),
            stdout: stdout.trim(),
          })
        );
        return;
      }

      resolve({
        exitCode,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
      });
    });
  });
}

function createSpooler(config) {
  return {
    buildCommand(filePath) {
      return buildSpoolCommand({
        copies: config.copies,
        filePath,
        media: config.printMedia,
        printerName: config.printerName,
        printerType: config.printerType,
        spooler: config.spooler,
      });
    },

    diagnostics() {
      return buildDiagnosticsCommands(config.printerName);
    },

    async submit(filePath) {
      const spoolCommand = this.buildCommand(filePath);

      if (config.mode === "dry-run") {
        return {
          accepted: true,
          dryRun: true,
          skippedReason: "dry_run_mode",
          spoolCommand,
          spoolerJobId: null,
        };
      }

      if (!config.allowSpoolerExecution) {
        throw new SpoolerError("Spooler execution is disabled for this worker process.", {
          code: "spool_rejected",
          spoolCommand,
        });
      }

      const result = await executeCommand(spoolCommand.command, spoolCommand.args);
      return {
        accepted: true,
        dryRun: false,
        spoolCommand,
        spoolerJobId: result.stdout || null,
      };
    },
  };
}

module.exports = {
  SpoolerError,
  buildDiagnosticsCommands,
  buildSpoolCommand,
  commandForDisplay,
  createSpooler,
};
