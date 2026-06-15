"use strict";

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function createLogger(level = "info", stream = process.stdout) {
  const threshold = LEVELS[level] || LEVELS.info;

  function write(logLevel, event, fields = {}) {
    if ((LEVELS[logLevel] || LEVELS.info) < threshold) {
      return;
    }

    stream.write(
      `${JSON.stringify({
        at: new Date().toISOString(),
        level: logLevel,
        event,
        ...fields,
      })}\n`
    );
  }

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

module.exports = {
  createLogger,
};
