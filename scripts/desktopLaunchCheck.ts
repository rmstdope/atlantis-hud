/**
 * R55's system test: install the desktop bundle a release is about to publish, launch it, and fail
 * unless its window opens.
 *
 * `release.yml` runs this in each bundle job, against the very file the job then uploads, so a
 * release cannot attach a desktop build that does not start on its own platform. Before this the
 * three bundles were built and published and nothing ever ran one; `tests/native/` drives the app,
 * but a CI build of it, never the artefact a player downloads.
 *
 *     pnpm exec tsx scripts/desktopLaunchCheck.ts <path to the .dmg, .exe installer or .AppImage>
 *
 * "The window opened" is asked of the operating system, not of the app, so nothing in the shell
 * has to cooperate:
 *
 * - macOS: an on-screen, layer-0 window owned by the launched pid, from `CGWindowListCopyWindowInfo`
 *   (the owner pid needs no screen-recording permission; a window's name would).
 * - Windows: the launched process has a main window handle.
 * - Linux: a visible X window carrying the configured title, under the `xvfb-run` the workflow
 *   wraps this in. By title rather than pid, because the AppImage runs the app as a child process.
 *
 * The decision itself - window, early exit, or deadline - is `waitForWindow`, kept free of the
 * operating system so it can be unit-tested; the probes are thin shells proven by the workflow run.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

/** What the polling loop can ask about the launched app. */
export type LaunchProbe = {
  /** The app's exit code once it has exited, `null` while it runs. */
  exited(): number | null;
  /** Whether the operating system shows the app's window yet. */
  windowShown(): Promise<boolean>;
};

export type LaunchOutcome =
  | { kind: "window"; afterMs: number }
  | { kind: "exited"; code: number }
  | { kind: "timeout"; afterMs: number };

export type WaitOptions = {
  timeoutMs: number;
  intervalMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

/** Poll until the window shows, the app exits, or the deadline passes - whichever comes first. */
export async function waitForWindow(probe: LaunchProbe, options: WaitOptions): Promise<LaunchOutcome> {
  const start = options.now();
  for (;;) {
    const code = probe.exited();
    if (code !== null) {
      return { kind: "exited", code };
    }
    const elapsed = options.now() - start;
    if (await probe.windowShown()) {
      return { kind: "window", afterMs: elapsed };
    }
    if (elapsed >= options.timeoutMs) {
      return { kind: "timeout", afterMs: elapsed };
    }
    await options.sleep(options.intervalMs);
  }
}

/** The line the workflow log shows for an outcome, and whether it passes. */
export function describeOutcome(outcome: LaunchOutcome): { ok: boolean; message: string } {
  switch (outcome.kind) {
    case "window":
      return { ok: true, message: `R55: the window opened ${Math.round(outcome.afterMs / 1000)} s after launch.` };
    case "exited":
      return { ok: false, message: `R55: the app exited with code ${outcome.code} before any window opened.` };
    case "timeout":
      return { ok: false, message: `R55: no window opened within ${Math.round(outcome.afterMs / 1000)} s of launch.` };
  }
}

/**
 * The commands that install `bundle` under `dir` the way a player would, before it is launched.
 *
 * The NSIS `/D=` argument must come last and unquoted, which is why the install directory is a
 * fresh temporary one with no spaces in its path.
 */
export function installCommands(
  platform: NodeJS.Platform,
  bundle: string,
  dir: string,
  productName: string
): string[][] {
  if (platform === "darwin") {
    const mount = posix.join(dir, "mount");
    const app = `${productName}.app`;
    return [
      ["hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint", mount, bundle],
      ["ditto", posix.join(mount, app), posix.join(dir, app)],
      ["hdiutil", "detach", mount]
    ];
  }
  if (platform === "win32") {
    return [[bundle, "/S", `/D=${win32.join(dir, "app")}`]];
  }
  return [["chmod", "+x", bundle]];
}

/**
 * Prints "shown" when `pid` has an on-screen, layer-0 window. JavaScript for Automation rather than
 * Swift: the macOS 26 SDK no longer exposes `CGWindowListCopyWindowInfo` to Swift, while the
 * Objective-C bridge still reaches it at run time.
 */
const MACOS_WINDOW_PROBE = `ObjC.import("CoreGraphics");
function run(argv) {
  const pid = Number(argv[0]);
  const list = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID);
  const windows = ObjC.deepUnwrap(ObjC.castRefToObject(list)) || [];
  return windows.some((w) => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0) ? "shown" : "none";
}
`;

function run(command: string[]): void {
  const [file, ...args] = command;
  console.log(`$ ${command.join(" ")}`);
  const result = spawnSync(file, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${file} failed (${result.error?.message ?? `exit ${result.status}`})`);
  }
}

function quiet(file: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync(file, args, { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "" };
}

/** The installed executable to launch, and how to ask whether its window is showing. */
function prepare(
  dir: string,
  bundle: string,
  productName: string,
  title: string
): { executable: string; env: NodeJS.ProcessEnv; windowShown: (pid: number) => boolean } {
  if (process.platform === "darwin") {
    const macos = posix.join(dir, `${productName}.app`, "Contents", "MacOS");
    const [binary] = readdirSync(macos);
    const probe = posix.join(dir, "windows.js");
    writeFileSync(probe, MACOS_WINDOW_PROBE);
    return {
      executable: posix.join(macos, binary),
      env: process.env,
      windowShown: (pid) => quiet("osascript", ["-l", "JavaScript", probe, String(pid)]).stdout.trim() === "shown"
    };
  }
  if (process.platform === "win32") {
    const installed = win32.join(dir, "app");
    const exe = readdirSync(installed).find((name) => /\.exe$/iu.test(name) && !/^uninstall/iu.test(name));
    if (exe === undefined) {
      throw new Error(`the installer left no executable in ${installed}: ${readdirSync(installed).join(", ")}`);
    }
    return {
      executable: win32.join(installed, exe),
      env: process.env,
      windowShown: (pid) => {
        const out = quiet("powershell", [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowHandle`
        ]).stdout.trim();
        return out !== "" && out !== "0";
      }
    };
  }
  return {
    executable: bundle,
    // The runner has no libfuse2, which an AppImage mounts itself with; this unpacks it instead.
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1" },
    windowShown: () => quiet("xdotool", ["search", "--onlyvisible", "--name", `^${title}$`]).status === 0
  };
}

function stop(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)]);
  } else {
    try {
      // The whole group: the AppImage's runtime and the app it started.
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function main(bundleArgument: string | undefined): Promise<number> {
  if (bundleArgument === undefined) {
    console.error("usage: tsx scripts/desktopLaunchCheck.ts <bundle>");
    return 2;
  }
  const bundle = resolve(bundleArgument);
  const conf = JSON.parse(
    readFileSync(new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8")
  ) as { productName: string; app: { windows: { title: string }[] } };
  const productName = conf.productName;
  const title = conf.app.windows[0].title;

  const dir = mkdtempSync(posix.join(tmpdir().replaceAll("\\", "/"), "r55-"));
  for (const command of installCommands(process.platform, bundle, dir, productName)) {
    run(command);
  }
  const { executable, env, windowShown } = prepare(dir, bundle, productName, title);

  console.log(`Launching ${executable}`);
  let output = "";
  const child = spawn(executable, [], { env, detached: process.platform !== "win32" });
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));
  let code: number | null = null;
  child.on("exit", (exitCode, signal) => (code = exitCode ?? (signal === null ? 0 : 128)));
  child.on("error", (error) => {
    output += `${error.message}\n`;
    code = 127;
  });

  try {
    const outcome = await waitForWindow(
      { exited: () => code, windowShown: async () => child.pid !== undefined && windowShown(child.pid) },
      {
        timeoutMs: 90_000,
        intervalMs: 1_000,
        now: () => Date.now(),
        sleep: (ms) => new Promise((done) => setTimeout(done, ms))
      }
    );
    const { ok, message } = describeOutcome(outcome);
    if (ok) {
      console.log(message);
      return 0;
    }
    console.log(`The app's output:\n${output || "(none)"}`);
    console.log(`::error::${message}`);
    return 1;
  } finally {
    stop(child);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main(process.argv[2]).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.log(`::error::R55: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  );
}
