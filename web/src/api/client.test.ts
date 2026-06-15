import { createApiClient } from "./client";

describe("createApiClient", () => {
  it("attaches the injected Firebase ID token to requests", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: typeof fetch = (input, init) => {
      calls.push([input, init]);

      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }));
    };

    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetcher,
      tokenProvider: {
        getIdToken: () => Promise.resolve("fresh-token"),
      },
    });

    await client.get<{ ok: boolean }>("/api/events");

    const [url, init] = calls[0];
    expect(url).toBe("https://api.example.test/api/events");
    expect(init).toBeDefined();

    if (!init) {
      throw new Error("Expected request init");
    }

    expect(init.headers).toBeInstanceOf(Headers);
    expect(init.method).toBe("GET");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer fresh-token");
  });

  it("unwraps successful API envelopes before returning data", async () => {
    const fetcher: typeof fetch = () => {
      return Promise.resolve(new Response(JSON.stringify({
        data: [{ id: "event-2026", registration: true }],
        ok: true,
        requestId: "req-1",
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }));
    };

    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetcher,
      tokenProvider: {
        getIdToken: () => Promise.resolve("fresh-token"),
      },
    });

    await expect(client.get<Array<{ id: string; registration: boolean }>>("/api/me/events")).resolves.toEqual([
      { id: "event-2026", registration: true },
    ]);
  });

  it("uses backend error envelope messages", async () => {
    const fetcher: typeof fetch = () => {
      return Promise.resolve(new Response(JSON.stringify({
        error: {
          code: "EVENT_MANAGER_REQUIRED",
          message: "A super_admin or event_manager user is required",
        },
        ok: false,
        requestId: "req-2",
      }), {
        headers: { "content-type": "application/json" },
        status: 403,
      }));
    };

    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetcher,
      tokenProvider: {
        getIdToken: () => Promise.resolve("fresh-token"),
      },
    });

    await expect(client.get("/api/events")).rejects.toMatchObject({
      message: "A super_admin or event_manager user is required",
      status: 403,
    });
  });
});
