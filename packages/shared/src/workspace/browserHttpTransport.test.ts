import { afterEach, describe, expect, it, vi } from "vitest";

import { browserHttpTransport } from "./browserHttpTransport";
import { newAgeClient } from "./newAgeApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserHttpTransport", () => {
  it("passes the request through fetch with no credentials and no cache", async () => {
    const fetch = vi.fn(async () => ({ status: 200, text: async () => "" }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    const headers = { authorization: "Bearer t" };

    await browserHttpTransport({ method: "POST", url: "https://example.test/x", headers, body: "b" }, signal);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://example.test/x", {
      method: "POST",
      headers,
      body: "b",
      signal,
      credentials: "omit",
      cache: "no-store"
    });
  });

  it("answers with the status and the body as text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, text: async () => "report" })));

    await expect(
      browserHttpTransport({ method: "GET", url: "https://example.test/r", headers: {} }, new AbortController().signal)
    ).resolves.toEqual({ status: 200, body: "report" });
  });

  it("resolves rather than rejects on a status the world refused with", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401, text: async () => "" })));

    await expect(
      browserHttpTransport({ method: "GET", url: "https://example.test/r", headers: {} }, new AbortController().signal)
    ).resolves.toEqual({ status: 401, body: "" });
  });

  it("rejects when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));

    await expect(
      browserHttpTransport({ method: "GET", url: "https://example.test/r", headers: {} }, new AbortController().signal)
    ).rejects.toThrow();
  });

  it("a rejected fetch becomes unreachable at the client", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));

    await expect(
      newAgeClient(browserHttpTransport, "arcanum").login("27", "pw", new AbortController().signal)
    ).resolves.toEqual({ kind: "unreachable" });
  });
});
