"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildDiagnosticsCommands, buildSpoolCommand } = require("../lib/spooler");

test("builds a Brother QL-800 CUPS lp command without shell interpolation", () => {
  const plan = buildSpoolCommand({
    filePath: "/tmp/badge.pdf",
    media: "Custom.62x100mm",
    printerName: "Brother QL-800 Badges",
    printerType: "brother-ql-800",
  });

  assert.equal(plan.command, "lp");
  assert.deepEqual(plan.args, [
    "-d",
    "Brother QL-800 Badges",
    "-o",
    "media=Custom.62x100mm",
    "/tmp/badge.pdf",
  ]);
  assert.match(plan.display, /'Brother QL-800 Badges'/);
  assert.deepEqual(plan.warnings, []);
});

test("marks DYMO as a later validation path", () => {
  const plan = buildSpoolCommand({
    filePath: "/tmp/badge.pdf",
    printerName: "DYMO Badge Printer",
    printerType: "dymo",
  });

  assert.equal(plan.command, "lp");
  assert.equal(plan.warnings.length, 1);
});

test("builds printer diagnostic commands", () => {
  const commands = buildDiagnosticsCommands("Brother_QL_800_Badges");

  assert.equal(commands.length, 3);
  assert.deepEqual(commands[0].args, ["-p", "Brother_QL_800_Badges", "-l"]);
});
