"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createTerminalStatusUi,
  printSummaryFromResult,
  renderState,
  shouldEnableTerminalUi,
} = require("../lib/status-ui");

test("renders terminal status with API URL, last check, and print history", () => {
  const output = renderState(
    {
      apiBaseUrl: "http://localhost:3000",
      eventId: "twilio-assemble-sao-paulo",
      lastCheckAt: "2026-06-15T12:00:00.000Z",
      lastCheckMessage: "print job completed",
      lastError: "",
      mode: "watch",
      printerName: "Brother_QL_800_Badges",
      printerType: "brother-ql-800",
      prints: [
        {
          at: "2026-06-15T12:00:01.000Z",
          artifactPath: "/tmp/badge.pdf",
          company: "Acme Events",
          dryRun: false,
          jobId: "job-1",
          name: "Ana Silva",
          queueId: "default",
          status: "printed",
        },
      ],
      queueIds: ["default"],
      startedAt: "2026-06-15T11:59:00.000Z",
      status: "Printed",
      terminalId: "terminal-1",
      terminalName: "Printer terminal",
    },
    120
  );

  assert.match(output, /^\+-+\+$/m);
  assert.match(output, /\| Status\s+\| Printed/);
  assert.match(output, /\| API URL\s+\| http:\/\/localhost:3000/);
  assert.match(output, /\| Last check\s+\| 2026-06-15T12:00:00.000Z - print job completed/);
  assert.match(output, /\| Time\s+\| Status\s+\| Queue\s+\| Attendee/);
  assert.match(output, /job-1/);
  assert.match(output, /Ana Silva/);
  assert.match(output, /artifact=\/tmp\/badge.pdf/);

  for (const line of output.trimEnd().split("\n")) {
    assert.equal(line.length, 120);
  }
});

test("status UI records completed print jobs", () => {
  const writes = [];
  const stream = {
    columns: 120,
    isTTY: true,
    write: (chunk) => writes.push(chunk),
  };
  const ui = createTerminalStatusUi(
    {
      apiBaseUrl: "http://localhost:3000",
      eventId: "event-1",
      mode: "watch",
      printerName: "Printer",
      printerType: "brother-ql-800",
      queueIds: [],
      terminalId: "terminal-1",
      terminalName: "Printer terminal",
      terminalUi: "on",
    },
    {
      clearScreen: false,
      stream,
    }
  );

  ui.recordCheckStart(new Date("2026-06-15T12:00:00.000Z"));
  ui.recordPrint(
    {
      artifact: {
        plannedBadgePath: "/tmp/job-1.pdf",
      },
      renderData: {
        job: {
          jobId: "job-1",
          queueId: "default",
        },
        label: {
          company: "Acme Events",
          fullName: "Ana Silva",
        },
      },
      spoolResult: {
        dryRun: true,
      },
      status: "printed",
    },
    new Date("2026-06-15T12:00:01.000Z")
  );

  const output = writes.join("");
  assert.match(output, /Checking/);
  assert.match(output, /printed dry-run/);
  assert.match(output, /job-1/);
});

test("status UI renders when forced even if stdout is not marked as TTY", () => {
  const writes = [];
  const stream = {
    columns: 120,
    isTTY: false,
    write: (chunk) => writes.push(chunk),
  };
  const ui = createTerminalStatusUi(
    {
      apiBaseUrl: "http://localhost:3000",
      eventId: "event-1",
      mode: "watch",
      printerName: "Printer",
      printerType: "brother-ql-800",
      queueIds: [],
      terminalId: "terminal-1",
      terminalName: "Printer terminal",
      terminalUi: "on",
    },
    {
      clearScreen: false,
      stream,
    }
  );

  ui.start();

  assert.equal(ui.enabled, true);
  assert.match(writes.join(""), /Swoogo Print Worker/);
});

test("status UI auto mode follows stdout TTY detection", () => {
  assert.equal(shouldEnableTerminalUi({ terminalUi: "auto" }, { isTTY: false }), false);
  assert.equal(shouldEnableTerminalUi({ terminalUi: "auto" }, { isTTY: true }), true);
  assert.equal(shouldEnableTerminalUi({ terminalUi: "off" }, { isTTY: true }), false);
  assert.equal(shouldEnableTerminalUi({ terminalUi: "on" }, { isTTY: false }), true);
});

test("creates print history summaries from process results", () => {
  const summary = printSummaryFromResult(
    {
      artifact: {
        plannedBadgePath: "/tmp/job-2.pdf",
      },
      renderData: {
        job: {
          jobId: "job-2",
          queueId: "vip",
        },
        label: {
          company: "Signal",
          fullName: "Luis Leao",
        },
      },
      status: "printed",
    },
    new Date("2026-06-15T13:00:00.000Z")
  );

  assert.deepEqual(summary, {
    at: "2026-06-15T13:00:00.000Z",
    artifactPath: "/tmp/job-2.pdf",
    company: "Signal",
    dryRun: false,
    jobId: "job-2",
    name: "Luis Leao",
    queueId: "vip",
    status: "printed",
  });
});
