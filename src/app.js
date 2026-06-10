const express = require("express");
const packageJson = require("../package.json");

const app = express();

app.disable("x-powered-by");
app.use(express.json());

app.get("/", (_request, response) => {
  response.json({
    name: packageJson.name,
    version: packageJson.version,
    status: "ok",
  });
});

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not Found" });
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "Internal Server Error" });
});

module.exports = app;
