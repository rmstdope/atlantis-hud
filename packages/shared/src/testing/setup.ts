import { readFileSync } from "node:fs";
import { beforeEach } from "vitest";
import { noDomHintFor } from "./noDom";

/**
 * Vitest setup for `packages/shared`: when a test that renders components fails, print what this
 * package's tests cannot do beside the red. See `noDom.ts` for why, and `vitest.config.ts` for the
 * wiring. Nothing else belongs in here - a setup file runs before all 43 test files, so anything
 * added has to be worth that.
 */

const shown = new Set<string>();

beforeEach((context) => {
  const path = context.task?.file?.filepath;
  context.onTestFailed(() => {
    if (path === undefined) {
      return;
    }
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      return;
    }
    const hint = noDomHintFor(path, source, shown);
    if (hint !== null) {
      process.stderr.write(`\n${hint}\n\n`);
    }
  });
});
