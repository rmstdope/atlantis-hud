import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "web",
      testMatch: /web\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4173" }
    },
    {
      name: "desktop-shell",
      testMatch: /desktop\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4174" }
    }
  ],
  webServer: [
    {
      command: "pnpm --filter @atlantis/web dev --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI
    },
    {
      command: "pnpm --filter @atlantis/desktop dev --host 127.0.0.1 --port 4174",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: !process.env.CI
    }
  ]
});
