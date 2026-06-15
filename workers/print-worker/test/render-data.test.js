"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createLabelRenderData, normalizeLayout } = require("../lib/render-data");

test("creates simple label render data for QR and text fields", () => {
  const renderData = createLabelRenderData({
    jobId: "job-1",
    queueId: "default",
    credentialBadgeId: "a7Kx9Qm2Pz4R8tY6uV3n",
    payloadSnapshot: {
      credentialQrPayload: "a7Kx9Qm2Pz4R8tY6uV3n;1781269200;26361060",
      fullName: "  Ana   Silva ",
      company: " Acme Events ",
      jobTitle: " CMO ",
    },
  });

  assert.equal(renderData.label.fullName, "Ana Silva");
  assert.equal(renderData.label.firstName, "Ana");
  assert.equal(renderData.label.company, "Acme Events");
  assert.equal(renderData.label.jobTitle, "CMO");
  assert.equal(renderData.fields.find((field) => field.id === "qr").value, renderData.label.qrPayload);
});

test("rejects unsupported layout field sources", () => {
  assert.throws(() =>
    normalizeLayout({
      size: {
        widthMm: 62,
        heightMm: 100,
      },
      dpi: 300,
      fields: [
        {
          id: "bad",
          type: "text",
          source: "secretField",
          visible: true,
          xMm: 0,
          yMm: 0,
          widthMm: 10,
          heightMm: 10,
        },
      ],
    })
  );
});
