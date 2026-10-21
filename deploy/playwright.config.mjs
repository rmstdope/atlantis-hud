import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../tests/pwa",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:18080",
    trace: "on-first-retry"
  }
});
