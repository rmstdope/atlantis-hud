import { defineConfig } from "vitest/config";

/**
 * This package has **no test environment**: its component tests render with
 * `renderToStaticMarkup`, and adding jsdom was declined deliberately (ah-nass) - it would cost a
 * slower suite on every run and a second way to write a component test alongside the forty-odd
 * files that use the first way. `src/testing/setup.ts` is here to say so when a test goes red.
 */
export default defineConfig({
  test: {
    setupFiles: ["./src/testing/setup.ts"]
  }
});
