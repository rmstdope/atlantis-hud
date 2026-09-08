import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { serverPolicy } from "./playwrightServers";

/**
 * How the browser suites decide whether to reuse a server they did not start.
 *
 * The answer must be "never", said outright. It used to be `!process.env.CI`, which said it
 * indirectly and cost the fleet twice: a suite that quietly answered from another checkout's
 * preview server reported a working branch as broken (`docs/retrospectives/ah-lbd9.3.md`), and the
 * machine-wide gate lock in `scripts/withGateLock.ts` — which skips itself under `CI` — was
 * switched off by every agent that exported `CI=1` to get this behaviour.
 *
 * Reuse cannot be correct here in any case: the `command` builds and then previews, so a reused
 * server is a stale bundle by construction — and a stale bundle passes and proves nothing, or fails
 * and reads exactly like a broken branch.
 */
const CONFIGS = ["playwright.config.ts", "playwright.pwa.config.ts"] as const;

describe("the browser suites' server policy", () => {
  it("decides server reuse from no CI variable at all", () => {
    for (const path of CONFIGS) {
      expect(serverPolicy(readFileSync(path, "utf8")).readsCi, path).toBe(false);
    }
  });

  it("tells every webServer never to reuse one it did not start", () => {
    for (const path of CONFIGS) {
      const { reuseSettings } = serverPolicy(readFileSync(path, "utf8"));
      expect(reuseSettings.length, `${path}: no webServer entries found`).toBeGreaterThan(0);
      for (const setting of reuseSettings) {
        expect(setting, path).toBe("false");
      }
    }
  });

  it("passes --strictPort to every vite preview", () => {
    for (const path of CONFIGS) {
      expect(
        serverPolicy(readFileSync(path, "utf8")).previewCommandsWithoutStrictPort,
        path
      ).toBe(0);
    }
  });
});
