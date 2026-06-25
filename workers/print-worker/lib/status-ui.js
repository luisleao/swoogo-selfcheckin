"use strict";

const MAX_PRINT_HISTORY = 8;

function timestamp(value = new Date()) {
  if (!value) {
    return "Never";
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : date.toISOString();
}

function formatQueueIds(queueIds = []) {
  return Array.isArray(queueIds) && queueIds.length > 0 ? queueIds.join(", ") : "all queues";
}

function normalizeWidth(width) {
  const parsed = Number(width);
  if (!Number.isFinite(parsed)) {
    return 100;
  }

  return Math.max(72, Math.min(160, Math.floor(parsed)));
}

function cleanCell(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fitCell(value, width) {
  const line = cleanCell(value);

  if (line.length <= width) {
    return line.padEnd(width, " ");
  }

  if (width <= 3) {
    return ".".repeat(width);
  }

  return `${line.slice(0, width - 3)}...`;
}

function makeBorder(width) {
  return `+${"-".repeat(width - 2)}+`;
}

function makeColumnBorder(widths) {
  return `+${widths.map((columnWidth) => "-".repeat(columnWidth + 2)).join("+")}+`;
}

function makeFullRow(value, width) {
  return `| ${fitCell(value, width - 4)} |`;
}

function makeRow(values, widths) {
  return `|${widths
    .map((columnWidth, index) => ` ${fitCell(values[index], columnWidth)} `)
    .join("|")}|`;
}

function printColumnWidths(width) {
  const available = width - 13;
  const timeWidth = Math.min(24, Math.max(18, Math.floor(available * 0.28)));
  const statusWidth = Math.min(16, Math.max(15, Math.floor(available * 0.17)));
  const queueWidth = Math.min(16, Math.max(10, Math.floor(available * 0.18)));
  const attendeeWidth = available - timeWidth - statusWidth - queueWidth;

  return [timeWidth, statusWidth, queueWidth, attendeeWidth];
}

function printSummaryFromResult(result, at = new Date()) {
  const job = result?.renderData?.job || {};
  const label = result?.renderData?.label || {};

  return {
    at: timestamp(at),
    artifactPath: result?.artifact?.plannedBadgePath || "",
    company: label.company || "",
    dryRun: result?.spoolResult?.dryRun === true,
    jobId: job.jobId || "unknown-job",
    name: label.fullName || label.firstName || "Unknown attendee",
    queueId: job.queueId || "unassigned",
    status: result?.status || "printed",
  };
}

function renderState(state, width = 100) {
  const renderWidth = normalizeWidth(width);
  const metadataWidths = [16, renderWidth - 23];
  const prints = Array.isArray(state.prints) ? state.prints : [];
  const lastCheck = `${timestamp(state.lastCheckAt)}${
    state.lastCheckMessage ? ` - ${state.lastCheckMessage}` : ""
  }`;
  const metadataRows = [
    ["Status", state.status],
    ["API URL", state.apiBaseUrl || "not configured"],
    ["Event", state.eventId || "not configured"],
    [
      "Terminal",
      `${state.terminalName || state.terminalId || "not configured"} (${state.terminalId || "no id"})`,
    ],
    ["Printer", `${state.printerName || "not configured"} (${state.printerType || "unknown"})`],
    ["Mode", state.mode || "unknown"],
    ["Queues", formatQueueIds(state.queueIds)],
    ["Started", timestamp(state.startedAt)],
    ["Last check", lastCheck],
  ];
  const lines = [makeBorder(renderWidth), makeFullRow("Swoogo Print Worker", renderWidth)];

  lines.push(makeColumnBorder(metadataWidths));
  for (const row of metadataRows) {
    lines.push(makeRow(row, metadataWidths));
  }

  if (state.lastError) {
    lines.push(makeRow(["Last error", state.lastError], metadataWidths));
  }

  lines.push(makeColumnBorder(metadataWidths));
  lines.push(makeFullRow("Last prints", renderWidth));

  const historyWidths = printColumnWidths(renderWidth);
  lines.push(makeColumnBorder(historyWidths));
  lines.push(makeRow(["Time", "Status", "Queue", "Attendee"], historyWidths));
  lines.push(makeColumnBorder(historyWidths));

  if (prints.length === 0) {
    lines.push(makeRow(["", "", "", "No print jobs completed yet."], historyWidths));
  } else {
    for (const print of prints) {
      const dryRunLabel = print.dryRun ? " dry-run" : "";
      const details = [`job=${print.jobId}`];

      if (print.company) {
        details.push(`company=${print.company}`);
      }

      if (print.artifactPath) {
        details.push(`artifact=${print.artifactPath}`);
      }

      lines.push(
        makeRow(
          [print.at, `${print.status}${dryRunLabel}`, print.queueId, print.name],
          historyWidths
        )
      );
      lines.push(makeFullRow(details.join("; "), renderWidth));
    }
  }

  lines.push(makeColumnBorder(historyWidths));
  lines.push(makeFullRow("Press Ctrl+C to stop.", renderWidth));
  lines.push(makeBorder(renderWidth));

  return `${lines.join("\n")}\n`;
}

function createNoopStatusUi() {
  return {
    enabled: false,
    recordCheckStart() {},
    recordError() {},
    recordNoJob() {},
    recordPrint() {},
    render() {},
    start() {},
    stop() {},
  };
}

function shouldEnableTerminalUi(config, stream) {
  const mode = config.terminalUi;

  if (mode === false || mode === "off") {
    return false;
  }

  if (mode === "auto") {
    return stream.isTTY === true;
  }

  return true;
}

function createTerminalStatusUi(config, options = {}) {
  const stream = options.stream || process.stdout;
  const enabled = options.enabled ?? shouldEnableTerminalUi(config, stream);

  if (!enabled) {
    return createNoopStatusUi();
  }

  const state = {
    apiBaseUrl: config.apiBaseUrl,
    eventId: config.eventId,
    lastCheckAt: null,
    lastCheckMessage: "",
    lastError: "",
    mode: config.mode,
    printerName: config.printerName,
    printerType: config.printerType,
    prints: [],
    queueIds: config.queueIds,
    startedAt: new Date(),
    status: "Starting",
    terminalId: config.terminalId,
    terminalName: config.terminalName,
  };

  const clearScreen = options.clearScreen !== false;
  const width = options.width || stream.columns || 100;

  const render = () => {
    if (clearScreen) {
      stream.write("\x1b[2J\x1b[H");
    }

    stream.write(renderState(state, width));
  };

  return {
    enabled: true,
    recordCheckStart(at = new Date()) {
      state.lastCheckAt = at;
      state.lastCheckMessage = "checking for queued print jobs";
      state.status = "Checking";
      render();
    },
    recordError(error, at = new Date()) {
      state.lastCheckAt = at;
      state.lastCheckMessage = "error";
      state.lastError = error?.message || String(error);
      state.status = "Error - retrying";
      render();
    },
    recordNoJob(at = new Date()) {
      state.lastCheckAt = at;
      state.lastCheckMessage = "no queued jobs";
      state.status = "Idle";
      render();
    },
    recordPrint(result, at = new Date()) {
      state.lastCheckAt = at;
      state.lastCheckMessage = "print job completed";
      state.lastError = "";
      state.status = "Printed";
      state.prints = [printSummaryFromResult(result, at), ...state.prints].slice(0, MAX_PRINT_HISTORY);
      render();
    },
    render,
    start() {
      state.status = "Starting";
      render();
    },
    stop() {
      state.status = "Stopped";
      render();
    },
  };
}

module.exports = {
  createNoopStatusUi,
  createTerminalStatusUi,
  printSummaryFromResult,
  renderState,
  shouldEnableTerminalUi,
};
