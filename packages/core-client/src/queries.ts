/**
 * The core's declared queries as adapter methods, for either transport (ah-w83n).
 *
 * `CORE_QUERIES` is generated from the one declaration in `crates/core/src/queries.rs`, as is the
 * `CoreQueries` type. Each adapter hands over how it asks the core one query - the desktop invokes
 * its `query` Tauri command, the browser calls its `query` wasm export - and gets back a method per
 * declared query. So a query added to the core arrives on both shells with nothing written here.
 */
import { CORE_QUERIES, type CoreQueries } from "./generated/CoreQueries";

/** Asks the core one declared query by its wire name, with its arguments in order. */
export type QueryCall = (name: string, args: unknown[]) => Promise<unknown>;

/** One method per declared query, each a call through `call`. */
export function createQueryMethods(call: QueryCall): CoreQueries {
  const methods: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [method, name] of Object.entries(CORE_QUERIES)) {
    methods[method] = (...args) => call(name, args);
  }
  return methods as unknown as CoreQueries;
}
