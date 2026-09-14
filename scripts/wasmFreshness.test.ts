/**
 * The dev servers' wasm freshness guard, middleware and plugin, with every dependency faked:
 * nothing here spawns `wasm-pack`, `cargo` or a Vite server.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import {
  createWasmFreshnessGuard,
  isDocumentRequest,
  wasmFreshness,
  wasmFreshnessMiddleware,
  type FreshnessOutcome
} from "./wasmFreshness";

function deferred(): { promise: Promise<void>; resolve(): void; reject(error: unknown): void } {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeRequest(method: string, headers: Record<string, string>): IncomingMessage {
  return { method, headers } as unknown as IncomingMessage;
}

function fakeResponse() {
  const recorded = { statusCode: 0, headers: {} as Record<string, string>, body: undefined as string | undefined };
  const res = {
    set statusCode(value: number) {
      recorded.statusCode = value;
    },
    get statusCode() {
      return recorded.statusCode;
    },
    setHeader(name: string, value: string) {
      recorded.headers[name] = value;
    },
    end(body?: string) {
      recorded.body = body;
    }
  };
  return { res: res as unknown as ServerResponse, recorded };
}

function fakeLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

function guardResolving(outcome: FreshnessOutcome) {
  return { ensureCurrent: vi.fn(() => Promise.resolve(outcome)) };
}

describe("createWasmFreshnessGuard", () => {
  it("resolves current without building when the core is current", async () => {
    const build = vi.fn(() => Promise.resolve());
    const guard = createWasmFreshnessGuard({ isCurrent: () => true, build });
    await expect(guard.ensureCurrent()).resolves.toBe("current");
    expect(build).not.toHaveBeenCalled();
  });

  it("shares one build between concurrent callers while the core is stale", async () => {
    const running = deferred();
    const build = vi.fn(() => running.promise);
    const guard = createWasmFreshnessGuard({ isCurrent: () => false, build });
    const first = guard.ensureCurrent();
    const second = guard.ensureCurrent();
    running.resolve();
    await expect(first).resolves.toBe("rebuilt");
    await expect(second).resolves.toBe("rebuilt");
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("retries on the next call after a failed build", async () => {
    const build = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const guard = createWasmFreshnessGuard({ isCurrent: () => false, build });
    await expect(guard.ensureCurrent()).rejects.toThrow("boom");
    await expect(guard.ensureCurrent()).resolves.toBe("rebuilt");
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("checks again after a finished build", async () => {
    const isCurrent = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const guard = createWasmFreshnessGuard({ isCurrent, build: () => Promise.resolve() });
    await expect(guard.ensureCurrent()).resolves.toBe("rebuilt");
    await expect(guard.ensureCurrent()).resolves.toBe("current");
    expect(isCurrent).toHaveBeenCalledTimes(2);
  });
});

describe("isDocumentRequest", () => {
  it("treats sec-fetch-dest document as a document", () => {
    expect(isDocumentRequest(fakeRequest("GET", { "sec-fetch-dest": "document" }))).toBe(true);
  });

  it("treats an accept header containing text/html as a document", () => {
    expect(
      isDocumentRequest(fakeRequest("GET", { accept: "text/html,application/xhtml+xml,*/*;q=0.8" }))
    ).toBe(true);
  });

  it("does not treat a script or wasm fetch as a document", () => {
    expect(isDocumentRequest(fakeRequest("GET", { accept: "*/*", "sec-fetch-dest": "script" }))).toBe(false);
  });

  it("does not treat a POST as a document", () => {
    expect(isDocumentRequest(fakeRequest("POST", { accept: "text/html" }))).toBe(false);
  });
});

describe("wasmFreshnessMiddleware", () => {
  it("passes a non-document request straight through without consulting the guard", () => {
    const guard = guardResolving("current");
    const next = vi.fn();
    const { res } = fakeResponse();
    wasmFreshnessMiddleware(guard, fakeLogger())(fakeRequest("GET", { accept: "*/*" }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(guard.ensureCurrent).not.toHaveBeenCalled();
  });

  it("waits for the guard and then calls next on a document request", async () => {
    const running = deferred();
    const guard = { ensureCurrent: vi.fn(() => running.promise.then((): FreshnessOutcome => "current")) };
    const next = vi.fn();
    const { res } = fakeResponse();
    const logger = fakeLogger();
    wasmFreshnessMiddleware(guard, logger)(fakeRequest("GET", { accept: "text/html" }), res, next);
    expect(next).not.toHaveBeenCalled();
    running.resolve();
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs a rebuild and calls next when the guard rebuilt", async () => {
    const next = vi.fn();
    const logger = fakeLogger();
    const { res } = fakeResponse();
    wasmFreshnessMiddleware(guardResolving("rebuilt"), logger)(
      fakeRequest("GET", { accept: "text/html" }),
      res,
      next
    );
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    expect(logger.info).toHaveBeenCalledWith("wasm core rebuilt from the current Rust sources");
  });

  it("answers a document request with 503 and never calls next when the build fails", async () => {
    const error = new Error("wasm-pack exited with status 1");
    const guard = { ensureCurrent: vi.fn(() => Promise.reject(error)) };
    const next = vi.fn();
    const logger = fakeLogger();
    const { res, recorded } = fakeResponse();
    wasmFreshnessMiddleware(guard, logger)(fakeRequest("GET", { accept: "text/html" }), res, next);
    await vi.waitFor(() => expect(recorded.body).toBeDefined());
    expect(recorded.statusCode).toBe(503);
    expect(recorded.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(recorded.body).toBe(
      "The WebAssembly core failed to build, so this dev server will not serve the stale one. " +
        "The build output is in the terminal running the dev server.\n\n" +
        String(error)
    );
    expect(logger.error).toHaveBeenCalledWith(String(error));
    expect(next).not.toHaveBeenCalled();
  });
});

describe("wasmFreshness", () => {
  it("registers its middleware from configureServer and applies only to serve", () => {
    const plugin = wasmFreshness({ repoRoot: "/nonexistent-repo-root" });
    expect(plugin.apply).toBe("serve");
    const use = vi.fn();
    plugin.configureServer({ middlewares: { use }, config: { logger: fakeLogger() } });
    expect(use).toHaveBeenCalledTimes(1);
    expect(use.mock.calls[0]![0]).toBeTypeOf("function");
  });
});
