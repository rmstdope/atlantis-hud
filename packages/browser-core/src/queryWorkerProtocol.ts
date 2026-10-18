/**
 * How the main thread asks the core a query that runs in a Web Worker (ah-iauy).
 *
 * The order checks - `validate_orders` and `preview_orders` - take hundreds of milliseconds on a
 * slow machine, and as single wasm calls on the main thread they froze the interface after every
 * pause in typing. In a worker the main thread only posts the request and receives the answer.
 *
 * Unlike the report-parsing worker issue #8 measured and removed, nothing large is rebuilt on the
 * way across: the requests are strings, and the answers are the plain objects the core already
 * built for the main thread, so receiving them by structured clone costs about what building them
 * there did.
 *
 * Kept free of the `Worker` global so both halves are tested with a fake port.
 */
import type { QueryCall } from "@atlantis/core-client";
import type { CoreWasmModule } from "./webCoreAdapter";

/** One query, numbered so its reply can find its way back. */
export type QueryRequest = { id: number; name: string; args: unknown[] };

/** The answer to the request with the same id: the core's value, or what it threw. */
export type QueryReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: unknown };

/** The worker cannot answer at all - it failed to load, or its core failed to instantiate. */
export class QueryWorkerUnavailable extends Error {
  constructor() {
    super("the core's worker is unavailable");
    this.name = "QueryWorkerUnavailable";
  }
}

/** What a `Worker` is, as far as asking it queries goes. */
export interface QueryPort {
  postMessage(message: QueryRequest): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: unknown) => void
  ): void;
}

/**
 * The worker's whole job: one query, answered.
 *
 * What the core throws travels as it was thrown. Its refusals are bare strings, and a caller has
 * always been rejected with that string itself.
 */
export function answerQuery(wasm: Pick<CoreWasmModule, "query">, request: QueryRequest): QueryReply {
  try {
    return { id: request.id, ok: true, value: wasm.query(request.name, request.args) };
  } catch (error) {
    return { id: request.id, ok: false, error };
  }
}

/**
 * Posts `reply` through `post`, or - when structured clone refuses the answer - a refusal saying
 * so under the same id. Without this the post would throw inside the worker, where nothing on the
 * main side hears it, and that call would wait for ever.
 */
export function postReply(post: (reply: QueryReply) => void, reply: QueryReply): void {
  try {
    post(reply);
  } catch (error) {
    post({ id: reply.id, ok: false, error: String(error) });
  }
}

/**
 * Asks the worker behind `port`, one call per query.
 *
 * The worker answers in the order it was asked, but nothing here depends on that: each reply
 * settles the call with its own id. A stale reply is still the caller's to drop, as it was on the
 * main thread. Once the worker fails, every pending and later call rejects with
 * `QueryWorkerUnavailable`, so the caller can run the query somewhere else rather than wait for
 * ever; so does every call once a reply arrives that cannot be read.
 */
export function createWorkerQueryCall(port: QueryPort): QueryCall {
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>();
  let nextId = 1;
  let failed = false;

  port.addEventListener("message", (event) => {
    const reply = (event as MessageEvent<QueryReply>).data;
    const waiting = pending.get(reply.id);
    if (!waiting) {
      return;
    }
    pending.delete(reply.id);
    if (reply.ok) {
      waiting.resolve(reply.value);
    } else {
      waiting.reject(reply.error);
    }
  });

  // A reply that cannot be read carries no id to settle, so it counts as the worker failing.
  const fail = () => {
    failed = true;
    for (const waiting of pending.values()) {
      waiting.reject(new QueryWorkerUnavailable());
    }
    pending.clear();
  };
  port.addEventListener("error", fail);
  port.addEventListener("messageerror", fail);

  return (name, args) => {
    if (failed) {
      return Promise.reject(new QueryWorkerUnavailable());
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port.postMessage({ id, name, args });
    });
  };
}
