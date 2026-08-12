import { defineConfig } from "vitest/config";

/**
 * Tests for the repository's own tooling, which lives in `scripts/` and belongs to no package.
 *
 * Deliberately narrow: every workspace package runs its own `vitest run` from its own directory, and
 * this config exists so `scripts/` has somewhere to be tested at all rather than to gather those up.
 *
 * The name is why it works, and it must not be `vitest.config.ts`. Vitest searches parent directories
 * for a `vitest.config.*`, so a config by that name at the repository root is picked up by every
 * package's own `vitest run` as well - and the include below names no tests that any package owns, so
 * each of them would exit on "no test files found". Passed by `--config` from `test:tooling` instead,
 * it applies where it was meant to and nowhere else.
 */
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts"]
  }
});
