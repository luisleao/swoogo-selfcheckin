"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { getPublicConfig } = require("./config");
const { createPrintJobClient, normalizePrintJobError } = require("./job-client");
const { createLogger } = require("./logger");
const { createLabelRenderData } = require("./render-data");
const { createSpooler } = require("./spooler");

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function safeFilePart(value) {
  return String(value || "job").replace(/[^A-Za-z0-9_.-]/g, "_");
}

function writeRenderDataArtifact(renderData, config) {
  fs.mkdirSync(config.badgeRenderTmpDir, { recursive: true });

  const basename = `${safeFilePart(renderData.job.jobId)}-${Date.now()}`;
  const renderDataPath = path.join(config.badgeRenderTmpDir, `${basename}.render.json`);
  const plannedBadgePath = path.join(
    config.badgeRenderTmpDir,
    `${basename}.${config.printOutputFormat}`
  );

  fs.writeFileSync(`${renderDataPath}.tmp`, `${JSON.stringify(renderData, null, 2)}\n`);
  fs.renameSync(`${renderDataPath}.tmp`, renderDataPath);

  return {
    plannedBadgePath,
    renderDataPath,
  };
}

async function processOnce(config, dependencies = {}) {
  const logger = dependencies.logger || createLogger(config.logLevel);
  const jobClient = dependencies.jobClient || createPrintJobClient(config);
  const spooler = dependencies.spooler || createSpooler(config);
  const startedAt = Date.now();
  let job = null;

  logger.info("print_worker.process_once.start", {
    config: getPublicConfig(config),
  });

  try {
    job = await jobClient.claimNextJob({
      queueIds: config.queueIds,
      terminalId: config.terminalId,
    });

    if (!job) {
      logger.info("print_worker.no_job", {
        terminalId: config.terminalId,
      });
      return {
        status: "no_job",
      };
    }

    logger.info("print_worker.job_claimed", {
      jobId: job.jobId,
      queueId: job.queueId,
      terminalId: config.terminalId,
    });

    const renderData = createLabelRenderData(job);
    const artifact = writeRenderDataArtifact(renderData, config);
    const spoolResult = await spooler.submit(artifact.plannedBadgePath);

    if (!spoolResult.accepted) {
      const error = new Error("Spooler did not accept the badge job.");
      error.code = "spool_rejected";
      error.details = spoolResult;
      throw error;
    }

    const completion = await jobClient.completeJob(job, {
      artifact,
      durationMs: Date.now() - startedAt,
      spooler: spoolResult,
    });

    logger.info("print_worker.job_completed", {
      durationMs: Date.now() - startedAt,
      jobId: job.jobId,
      plannedBadgePath: artifact.plannedBadgePath,
      renderDataPath: artifact.renderDataPath,
      spoolerCommand: spoolResult.spoolCommand.display,
      spoolerDryRun: spoolResult.dryRun,
      status: completion.status,
    });

    return {
      artifact,
      completion,
      renderData,
      spoolResult,
      status: "printed",
    };
  } catch (error) {
    const normalizedError = normalizePrintJobError(error, error.code || "unknown");

    if (job) {
      await jobClient.failJob(job, normalizedError);
    }

    logger.error("print_worker.job_failed", {
      durationMs: Date.now() - startedAt,
      error: normalizedError,
      jobId: job && job.jobId,
    });

    throw error;
  }
}

async function runWatch(config, dependencies = {}) {
  const logger = dependencies.logger || createLogger(config.logLevel);

  logger.info("print_worker.watch.start", {
    config: getPublicConfig(config),
  });

  while (true) {
    try {
      await processOnce(config, {
        ...dependencies,
        logger,
      });
    } catch (error) {
      logger.error("print_worker.watch_iteration_failed", {
        error: normalizePrintJobError(error, error.code || "unknown"),
      });
    }

    await sleep(config.claimPollIntervalMs);
  }
}

async function runWorker(config, dependencies = {}) {
  if (config.mode === "watch") {
    return runWatch(config, dependencies);
  }

  return processOnce(config, dependencies);
}

module.exports = {
  processOnce,
  runWorker,
  writeRenderDataArtifact,
};
