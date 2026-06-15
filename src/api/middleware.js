const { randomUUID } = require("node:crypto");
const { fromExpressError } = require("./errors");
const { sendError } = require("./responses");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function requestIdMiddleware(request, response, next) {
  const inboundRequestId = request.get("x-request-id");
  const requestId = REQUEST_ID_PATTERN.test(inboundRequestId || "")
    ? inboundRequestId
    : randomUUID();

  request.id = requestId;
  response.locals.requestId = requestId;
  response.set("x-request-id", requestId);
  next();
}

function requestLogger(logger) {
  if (!logger || typeof logger.info !== "function") {
    return (_request, _response, next) => next();
  }

  return (request, response, next) => {
    const startedAt = Date.now();

    response.on("finish", () => {
      logger.info({
        type: "http_request",
        requestId: request.id,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  };
}

function errorHandler(logger) {
  return (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const apiError = fromExpressError(error);

    if (logger) {
      const logMethod = apiError.status >= 500 ? logger.error : logger.warn;
      if (typeof logMethod === "function") {
        logMethod.call(logger, {
          type: "http_error",
          requestId: request.id,
          method: request.method,
          path: request.originalUrl,
          statusCode: apiError.status,
          code: apiError.code,
          message: apiError.message,
        });
      }
    }

    sendError(response, apiError);
  };
}

module.exports = {
  errorHandler,
  requestIdMiddleware,
  requestLogger,
};
