import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { DATA_HOME } from "./tests/native/env";

/**
 * The native suite: WebdriverIO talking to tauri-driver, which proxies to WebKitWebDriver and
 * launches the real release binary. This is the only configuration in the repository that
 * crosses Tauri IPC — the Playwright projects drive the same frontend, but in a plain browser
 * where the core runs as WebAssembly and the native transport never exists.
 *
 * Linux only, deliberately: WebKitGTK is the one webview that speaks WebDriver. macOS's
 * WKWebView exposes no automation endpoint at all, which is why the macOS job in CI checks that
 * the shell compiles and this suite checks that it works.
 */

const ROOT = __dirname;

/**
 * The binary `tauri build --debug --features desktop-runtime --no-bundle` leaves behind.
 *
 * Debug rather than release, because this suite asserts IPC binding and persistence — neither of
 * which optimization level can change — and the release build costs CI four minutes a run where
 * the debug build costs one. The optimized binary this suite skips is still built and shipped by
 * the release workflow. Overridable for driving a different build locally.
 */
const APP_BINARY =
  process.env.ATLANTIS_NATIVE_BINARY ??
  resolve(ROOT, "target", "debug", "atlantis-hud-desktop-shell");

const RESULTS_DIR = join(ROOT, "test-results", "native");

const TAURI_DRIVER_PORT = 4444;

let tauriDriver: ChildProcess | undefined;

/** Polls until something accepts a connection, because tauri-driver gives no readiness signal. */
function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePort, rejectPort) => {
    const attempt = () => {
      const socket = createConnection({ host: "127.0.0.1", port }, () => {
        socket.end();
        resolvePort();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          rejectPort(new Error(`tauri-driver never listened on port ${port}`));
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

export const config: WebdriverIO.Config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: TAURI_DRIVER_PORT,
  path: "/",
  specs: ["./tests/native/**/*.spec.ts"],
  // One app instance at a time: every session is a fresh launch of the same binary against the
  // same data directory, and two of those running beside each other would share a database.
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: APP_BINARY
      },
      // WebKitWebDriver speaks classic WebDriver only; without this, wdio 9 probes for BiDi
      // and the session handshake hangs.
      "wdio:enforceWebDriverClassic": true
    } as WebdriverIO.Capabilities
  ],
  logLevel: "warn",
  framework: "mocha",
  // Generous, because the first test of a session pays the whole app launch.
  mochaOpts: { ui: "bdd", timeout: 180_000 },
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  reporters: ["spec"],
  // `node:sqlite` sits behind a flag on Node 22; once it is unflagged this is a no-op.
  execArgv: ["--experimental-sqlite"],

  onPrepare: async () => {
    // The wipe is the suite's isolation: the shell keeps its games under XDG_DATA_HOME, so an
    // empty directory here is an application with no games, whatever an earlier run left.
    rmSync(DATA_HOME, { recursive: true, force: true });
    mkdirSync(DATA_HOME, { recursive: true });
    mkdirSync(RESULTS_DIR, { recursive: true });

    // tauri-driver launches the application itself, and the application inherits this
    // environment — which is the only place XDG_DATA_HOME can be planted.
    tauriDriver = spawn(
      "tauri-driver",
      ["--native-driver", process.env.WEBKIT_WEBDRIVER ?? "/usr/bin/WebKitWebDriver"],
      {
        stdio: "inherit",
        env: { ...process.env, XDG_DATA_HOME: DATA_HOME }
      }
    );
    tauriDriver.on("error", (error) => {
      throw new Error(`tauri-driver failed to start: ${error.message}`);
    });
    await waitForPort(TAURI_DRIVER_PORT, 30_000);
  },

  onComplete: () => {
    tauriDriver?.kill();
  },

  afterTest: async (test, _context, { passed }) => {
    if (!passed) {
      const name = test.title.replace(/[^a-z0-9]+/giu, "-").toLowerCase();
      await browser.saveScreenshot(join(RESULTS_DIR, `${name}.png`));
    }
  }
};
