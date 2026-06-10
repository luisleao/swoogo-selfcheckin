const assert = require("node:assert/strict");
const test = require("node:test");
const app = require("../src/app");

function listen() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", (error) => {
      if (error) {
        reject(error);
        return;
      }

      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });

    server.once("error", reject);
  });
}

test("GET /health returns ok", async () => {
  const { server, baseUrl } = await listen();

  try {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ok" });
  } finally {
    server.close();
  }
});

test("unknown routes return 404", async () => {
  const { server, baseUrl } = await listen();

  try {
    const response = await fetch(`${baseUrl}/missing`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: "Not Found" });
  } finally {
    server.close();
  }
});
