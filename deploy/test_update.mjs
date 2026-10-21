/** Verify an installed old PWA can discover the candidate without losing cached startup. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const browser = await chromium.launch();
let container;
const base = "http://127.0.0.1:18080";

async function start(image) {
  container = docker("run", "--detach", "-p", "127.0.0.1:18080:8080", image);
  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (docker("inspect", "--format", "{{.State.Health.Status}}", container) === "healthy") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("PWA update test container did not become healthy");
}

try {
  await start("atlantis-hud:previous-smoke");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.evaluate(() => localStorage.setItem("deployment-update-canary", "keep-me"));
  docker("rm", "--force", container);
  container = undefined;
  await start("atlantis-hud:smoke");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
  });
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.waiting?.state === "installed";
  }, undefined, { timeout: 60_000 });
  // Prompt-mode updates must not seize the open page or delete origin storage.
  assert.equal(await page.evaluate(() => localStorage.getItem("deployment-update-canary")), "keep-me");
  await context.setOffline(true);
  await page.reload();
  await page.getByTestId("game-gate").or(page.getByTestId("app-header")).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("deployment-update-canary")), "keep-me");
  await context.setOffline(false);
  await context.close();
  console.log("Old-to-new PWA update discovery, offline startup and storage preservation passed.");
} finally {
  await browser.close();
  if (container) docker("rm", "--force", container);
}
