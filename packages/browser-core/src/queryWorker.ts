/**
 * The core's worker (ah-iauy): its own instance of the core, answering the queries the main thread
 * sends it - the order checks, which would otherwise freeze the interface while they run.
 *
 * Its parse cache is its own, keyed on the report text like the main thread's, so the first check
 * pays one parse of the turn, here rather than there. A core that fails to load is thrown out of
 * the module, which is the `error` event the main side treats as "ask somewhere else".
 */
/// <reference lib="webworker" />
import { loadCoreWasm } from "./coreWasm";
import { answerQuery, type QueryRequest } from "./queryWorkerProtocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const core = loadCoreWasm();

scope.addEventListener("message", (event: MessageEvent<QueryRequest>) => {
  void core.then(
    (wasm) => scope.postMessage(answerQuery(wasm, event.data)),
    (error: unknown) => {
      // Asynchronously, so it surfaces as the worker's `error` event on the main thread.
      setTimeout(() => {
        throw error;
      });
    }
  );
});
