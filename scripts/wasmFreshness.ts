/**
 * A Vite dev-server plugin that rebuilds a stale WebAssembly core before serving a page (ah-rbuc).
 *
 * The core is gitignored and built locally, so a dev server that survives a merge or a pull would
 * otherwise go on serving the core it started with against newer TypeScript - which reopened two
 * correct features at P0 during manual verification. Every document request checks the source
 * fingerprint (tens of milliseconds) and, when it no longer matches, waits for a rebuild; a failed
 * rebuild answers 503 rather than serving the stale core.
 *
 * Only page loads are held. A tab already open during or after a rebuild can still fetch the core's
 * files as wasm-pack leaves them, so the guarantee is the next page load, not an open tab.
 *
 * `vite` does not resolve from `scripts/`, so the few shapes needed are declared structurally.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { buildWasm, wasmModuleIsCurrent } from "./ensure-wasm.mjs";

export type FreshnessOutcome = "current" | "rebuilt";

export interface FreshnessDeps {
  isCurrent(): boolean;
  build(): Promise<void>;
}

export interface FreshnessGuard {
  ensureCurrent(): Promise<FreshnessOutcome>;
}

/** Single-flight: concurrent calls share one build; a failed build clears so the next call retries. */
export function createWasmFreshnessGuard(deps: FreshnessDeps): FreshnessGuard {
  let pending: Promise<FreshnessOutcome> | null = null;

  return {
    ensureCurrent() {
      if (pending) return pending;
      if (deps.isCurrent()) return Promise.resolve("current");
      pending = deps.build().then(
        (): FreshnessOutcome => {
          pending = null;
          return "rebuilt";
        },
        (error: unknown) => {
          pending = null;
          throw error;
        }
      );
      return pending;
    }
  };
}

/** GET with `sec-fetch-dest: document`, or GET whose `accept` header includes `text/html`. */
export function isDocumentRequest(req: Pick<IncomingMessage, "method" | "headers">): boolean {
  if (req.method !== "GET") return false;
  if (req.headers["sec-fetch-dest"] === "document") return true;
  return (req.headers.accept ?? "").includes("text/html");
}

export interface FreshnessLogger {
  info(msg: string): void;
  error(msg: string): void;
}

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

const BUILD_FAILED_BODY =
  "The WebAssembly core failed to build, so this dev server will not serve the stale one. " +
  "The build output is in the terminal running the dev server.";

/** Connect-style middleware: non-documents pass straight to next(); documents wait for ensureCurrent(). */
export function wasmFreshnessMiddleware(guard: FreshnessGuard, logger: FreshnessLogger): Middleware {
  return (req, res, next) => {
    if (!isDocumentRequest(req)) {
      next();
      return;
    }
    guard.ensureCurrent().then(
      (outcome) => {
        if (outcome === "rebuilt") logger.info("wasm core rebuilt from the current Rust sources");
        next();
      },
      (error: unknown) => {
        logger.error(String(error));
        res.statusCode = 503;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(`${BUILD_FAILED_BODY}\n\n${String(error)}`);
      }
    );
  };
}

export interface DevServerLike {
  middlewares: { use(fn: Middleware): void };
  config: { logger: FreshnessLogger };
}

/** The Vite plugin. `apply: "serve"` keeps it out of `vite build`, and `vite preview` never calls configureServer. */
export function wasmFreshness(options: { repoRoot: string }): {
  name: string;
  apply: "serve";
  configureServer(server: DevServerLike): void;
} {
  return {
    name: "atlantis-wasm-freshness",
    apply: "serve",
    configureServer(server) {
      const guard = createWasmFreshnessGuard({
        isCurrent: () => wasmModuleIsCurrent(options.repoRoot),
        build: async () => {
          server.config.logger.info("wasm core is older than the Rust sources; rebuilding before serving");
          await buildWasm(options.repoRoot);
        }
      });
      // Registered directly rather than from a returned post-hook, which would run after Vite's
      // own HTML handling and never see the document request.
      server.middlewares.use(wasmFreshnessMiddleware(guard, server.config.logger));
    }
  };
}
