class ApiError extends Error {
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.expose = options.expose !== false;
    this.cause = options.cause;
  }
}

function apiError(status, code, message, options) {
  return new ApiError(status, code, message, options);
}

function validationError(details, message = "Validation failed") {
  return apiError(400, "VALIDATION_ERROR", message, { details });
}

function unauthorized(code = "UNAUTHENTICATED", message = "Authentication required", options) {
  return apiError(401, code, message, options);
}

function forbidden(code = "FORBIDDEN", message = "Forbidden", options) {
  return apiError(403, code, message, options);
}

function conflict(code = "CONFLICT", message = "Conflict", options) {
  return apiError(409, code, message, options);
}

function notFound(message = "Not Found") {
  return apiError(404, "NOT_FOUND", message);
}

function internalError(cause) {
  return apiError(500, "INTERNAL_ERROR", "Internal Server Error", {
    cause,
    expose: false,
  });
}

function fromExpressError(error) {
  if (error instanceof ApiError) {
    return error;
  }

  if (error && error.type === "entity.parse.failed") {
    return validationError(
      [{ field: "body", message: "Request body must be valid JSON" }],
      "Invalid JSON body",
    );
  }

  return internalError(error);
}

module.exports = {
  ApiError,
  apiError,
  conflict,
  forbidden,
  fromExpressError,
  internalError,
  notFound,
  unauthorized,
  validationError,
};
