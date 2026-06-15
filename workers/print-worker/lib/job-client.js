"use strict";

const fs = require("node:fs");
const { FieldValue } = require("firebase-admin/firestore");

const { getFirestoreDb } = require("../../../src/api/firebase-admin");

class PrintJobClientError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PrintJobClientError";
    this.code = details.code || "print_job_client_error";
    this.details = details;
  }
}

class PrintJobClient {
  async claimNextJob() {
    throw new PrintJobClientError("claimNextJob is not implemented.");
  }

  async completeJob() {
    throw new PrintJobClientError("completeJob is not implemented.");
  }

  async failJob() {
    throw new PrintJobClientError("failJob is not implemented.");
  }
}

class BackendPrintJobClient extends PrintJobClient {
  constructor(config) {
    super();
    this.config = config;
  }

  async claimNextJob() {
    if (!this.config.eventId) {
      throw new PrintJobClientError("eventId is required to claim Firestore print jobs.", {
        code: "claim_failed",
      });
    }

    const db = getFirestoreDb();
    const snapshot = await db
      .collection("events")
      .doc(this.config.eventId)
      .collection("printJobs")
      .where("status", "==", "queued")
      .limit(25)
      .get();
    const candidates = snapshot.docs.filter((doc) => {
      const data = doc.data() || {};
      return this.config.queueIds.length === 0 || !data.queueId || this.config.queueIds.includes(data.queueId);
    });

    if (candidates.length === 0) {
      return null;
    }

    const candidate = candidates[0];
    const claimed = await db.runTransaction(async (transaction) => {
      const freshSnapshot = await transaction.get(candidate.ref);
      const data = freshSnapshot.data() || {};

      if (!freshSnapshot.exists || data.status !== "queued") {
        return null;
      }

      transaction.set(candidate.ref, {
        claimedAt: FieldValue.serverTimestamp(),
        claimedByTerminalId: this.config.terminalId,
        status: "printing",
        terminalId: this.config.terminalId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: this.config.terminalId,
      }, { merge: true });

      return {
        ...data,
        jobId: freshSnapshot.id,
        status: "printing",
        terminalId: this.config.terminalId,
      };
    });

    return claimed;
  }

  async completeJob(job, result) {
    if (this.config.eventId && job?.jobId) {
      await getFirestoreDb()
        .collection("events")
        .doc(this.config.eventId)
        .collection("printJobs")
        .doc(job.jobId)
        .set({
          completedAt: FieldValue.serverTimestamp(),
          printResult: result,
          status: "printed",
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: this.config.terminalId,
        }, { merge: true });
    }

    return {
      dryRun: false,
      jobId: job.jobId,
      result,
      status: "complete_stubbed",
    };
  }

  async failJob(job, error) {
    if (this.config.eventId && job?.jobId) {
      await getFirestoreDb()
        .collection("events")
        .doc(this.config.eventId)
        .collection("printJobs")
        .doc(job.jobId)
        .set({
          failedAt: FieldValue.serverTimestamp(),
          printError: normalizePrintJobError(error),
          status: "print_failed",
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: this.config.terminalId,
        }, { merge: true });
    }

    return {
      dryRun: false,
      error: normalizePrintJobError(error),
      jobId: job && job.jobId,
      status: "fail_stubbed",
    };
  }
}

class DryRunPrintJobClient extends PrintJobClient {
  constructor(config) {
    super();
    this.config = config;
    this.claimed = false;
  }

  async claimNextJob() {
    if (this.claimed) {
      return null;
    }

    let fixture;
    try {
      fixture = JSON.parse(fs.readFileSync(this.config.dryRunFixturePath, "utf8"));
    } catch (error) {
      throw new PrintJobClientError("Unable to read dry-run print job fixture.", {
        code: "claim_failed",
        fixturePath: this.config.dryRunFixturePath,
        cause: error.message,
      });
    }

    if (fixture.status && fixture.status !== "queued") {
      throw new PrintJobClientError("Dry-run fixture must represent a queued print job.", {
        code: "claim_failed",
        status: fixture.status,
      });
    }

    if (
      this.config.queueIds.length > 0 &&
      fixture.queueId &&
      !this.config.queueIds.includes(fixture.queueId)
    ) {
      throw new PrintJobClientError("Dry-run fixture queue is not allowed for this terminal.", {
        code: "claim_failed",
        fixtureQueueId: fixture.queueId,
        queueIds: this.config.queueIds,
      });
    }

    this.claimed = true;
    return {
      ...fixture,
      jobId: fixture.jobId || "dry-run-print-job",
      status: "printing",
      terminalId: this.config.terminalId,
    };
  }

  async completeJob(job, result) {
    return {
      dryRun: true,
      jobId: job.jobId,
      printedAt: new Date().toISOString(),
      result,
      status: "printed",
    };
  }

  async failJob(job, error) {
    return {
      dryRun: true,
      error: normalizePrintJobError(error),
      jobId: job && job.jobId,
      status: "print_failed",
    };
  }
}

function normalizePrintJobError(error, stage = "unknown") {
  if (!error) {
    return {
      code: stage,
      message: "Unknown print worker error.",
      stage,
    };
  }

  return {
    code: error.code || stage || "unknown",
    details: error.details || undefined,
    message: error.message || String(error),
    name: error.name || "Error",
    stage: error.stage || stage,
  };
}

function createPrintJobClient(config) {
  if (config.mode === "dry-run") {
    return new DryRunPrintJobClient(config);
  }

  return new BackendPrintJobClient(config);
}

module.exports = {
  BackendPrintJobClient,
  DryRunPrintJobClient,
  PrintJobClient,
  PrintJobClientError,
  createPrintJobClient,
  normalizePrintJobError,
};
