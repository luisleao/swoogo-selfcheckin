function sendSuccess(response, data, options = {}) {
  response.status(options.status || 200).json({
    ok: true,
    data,
    requestId: response.locals.requestId,
  });
}

function sendError(response, error) {
  const body = {
    ok: false,
    error: {
      code: error.code,
      message: error.expose ? error.message : "Internal Server Error",
    },
    requestId: response.locals.requestId,
  };

  if (error.details) {
    body.error.details = error.details;
  }

  response.status(error.status || 500).json(body);
}

module.exports = {
  sendError,
  sendSuccess,
};
