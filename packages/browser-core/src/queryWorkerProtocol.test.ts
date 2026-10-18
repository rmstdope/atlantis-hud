import { describe, expect, it } from "vitest";
import {
  answerQuery,
  createWorkerQueryCall,
  QueryWorkerUnavailable,
  type QueryPort,
  type QueryReply,
  type QueryRequest
} from "./queryWorkerProtocol";

/** A worker as the client sees it: what it was sent, and a way to make it answer or fail. */
function fakePort() {
  const sent: QueryRequest[] = [];
  const listeners: Record<string, ((event: unknown) => void)[]> = { message: [], error: [] };
  const port: QueryPort = {
    postMessage: (message) => sent.push(message),
    addEventListener: (type, listener) => listeners[type].push(listener)
  };
  return {
    port,
    sent,
    reply: (data: QueryReply) => listeners.message.forEach((listener) => listener({ data })),
    fail: () => listeners.error.forEach((listener) => listener(new Event("error")))
  };
}

describe("answering a query in the worker", () => {
  it("answers with the core's value under the request's id", () => {
    const wasm = { query: (name: string, args: unknown[]) => ({ name, args }) };

    expect(answerQuery(wasm, { id: 7, name: "validate_orders", args: ["orders"] })).toEqual({
      id: 7,
      ok: true,
      value: { name: "validate_orders", args: ["orders"] }
    });
  });

  // The core refuses with a bare string; the caller has always been rejected with that string
  // itself, so it crosses the thread untouched rather than being wrapped.
  it("carries the core's refusal as it was thrown", () => {
    const wasm = {
      query: () => {
        throw "arguments could not be read: invalid length 0";
      }
    };

    expect(answerQuery(wasm, { id: 1, name: "preview_orders", args: [] })).toEqual({
      id: 1,
      ok: false,
      error: "arguments could not be read: invalid length 0"
    });
  });
});

describe("asking the worker from the main thread", () => {
  it("resolves each call by its own id, whatever order the replies come in", async () => {
    const worker = fakePort();
    const call = createWorkerQueryCall(worker.port);

    const first = call("validate_orders", ["a"]);
    const second = call("preview_orders", ["b"]);
    expect(worker.sent.map(({ name, args }) => [name, args])).toEqual([
      ["validate_orders", ["a"]],
      ["preview_orders", ["b"]]
    ]);
    expect(new Set(worker.sent.map(({ id }) => id)).size).toBe(2);

    worker.reply({ id: worker.sent[1].id, ok: true, value: "preview" });
    worker.reply({ id: worker.sent[0].id, ok: true, value: "validation" });

    await expect(first).resolves.toBe("validation");
    await expect(second).resolves.toBe("preview");
  });

  it("rejects with the core's refusal", async () => {
    const worker = fakePort();
    const call = createWorkerQueryCall(worker.port);

    const answer = call("validate_orders", []);
    worker.reply({ id: worker.sent[0].id, ok: false, error: "unknown core query" });

    await expect(answer).rejects.toBe("unknown core query");
  });

  // A worker that failed to load, or whose core failed to instantiate, will never answer. Saying
  // so - as its own kind of error - is what lets the adapter run the check on the main thread
  // instead of leaving the warnings unanswered for ever.
  it("rejects pending and later calls as unavailable once the worker fails", async () => {
    const worker = fakePort();
    const call = createWorkerQueryCall(worker.port);

    const pending = call("validate_orders", []);
    worker.fail();

    await expect(pending).rejects.toBeInstanceOf(QueryWorkerUnavailable);
    await expect(call("preview_orders", [])).rejects.toBeInstanceOf(QueryWorkerUnavailable);
    expect(worker.sent).toHaveLength(1);
  });

  it("ignores a reply nobody is waiting for", async () => {
    const worker = fakePort();
    const call = createWorkerQueryCall(worker.port);

    const answer = call("validate_orders", []);
    worker.reply({ id: 9999, ok: true, value: "stray" });
    worker.reply({ id: worker.sent[0].id, ok: true, value: "mine" });

    await expect(answer).resolves.toBe("mine");
  });
});
