import { defineConfig } from "vitest/config";

/**
 * Tests for the repository's own tooling, which lives in `scripts/` and belongs to no package.
 *
 * Deliberately narrow: every workspace package runs its own `vitest run` from its own directory, and
 * this config exists so `scripts/` has somewhere to be tested at all rather than to gather those up.
 *
 * The name is why it works. Vitest searches parent directories for a `vitest.config.*`, so a config
 * by that name at the root is found by every package as well - and this include, which names no test
 * a package owns, then leaves each of them exiting on "no test files found". Passed by `--config`
 * from `test:tooling` instead, it applies where it was meant to and nowhere else.
 */
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts"]
  }
});
