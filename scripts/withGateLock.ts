/**
 * Runs a command with the machine's gate lock held, so two agents never measure each other.
 *
 * Used by the browser suites, which are the ones that lie under contention - see `gateLock.ts` for
 * the measurement and `playwright.config.ts` for where it came from. Everything else in the gate is
 * merely slower when it shares a machine; these are the parts that go green or red for reasons that
 * have nothing to do with the code.
 *
 * Under CI there is nothing to serialise: every job has a runner to itself, and a lock file left
 * behind by anything else would be a way to hang a build for no benefit. So CI skips it entirely.
 */

import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeHolder, isRunning, parseHolder, shouldSteal } from "./gateLock";

/** One lock for the machine. Overridable so the tests can have one of their own. */
const LOCK_PATH = process.env.ATLANTIS_GATE_LOCK ?? join(tmpdir(), "atlantis-hud-gate.lock");

/** How often to look again while queued. Long enough to be quiet, short enough to feel prompt. */
const POLL_MS = 500;

/** How often to say something while waiting, so a long queue does not look like a hang. */
const SAY_EVERY_MS = 15_000;

/**
 * The command, with any bare `--` dropped.
 *
 * `pnpm run test:smoke -- --project=web` forwards the separator itself, and Playwright reads a bare
 * `--` as a positional filter: it then matches no spec, having already built and served the app, and
 * sits there looking like a hang. Nothing downstream ever wants the separator as an argument.
 */
const command = process.argv.slice(2).filter((argument) => argument !== "--");

if (command.length === 0) {
  process.stderr.write("usage: withGateLock <command> [args...]\n");
  process.exit(2);
}

if (process.env.CI) {
  run().then((code) => process.exit(code));
} else {
  main().then((code) => process.exit(code));
}

async function main(): Promise<number> {
  await acquire();

  // Released whatever happens, including a signal: a lock that outlives its holder is the failure
  // this must not have. The stale check in `gateLock` is the backstop, not the plan.
  const release = () => {
    try {
      rmSync(LOCK_PATH, { force: true });
    } catch {
      // Already gone, or somebody stole it believing us dead. Either way there is nothing to undo.
    }
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      release();
      process.exit(130);
    });
  }

  try {
    return await run();
  } finally {
    release();
  }
}

/** Waits until the lock is ours, however long that takes. */
async function acquire(): Promise<void> {
  const startedWaiting = Date.now();
  let saidAt = 0;

  for (;;) {
    if (take()) {
      return;
    }

    const holder = parseHolder(readQuietly(LOCK_PATH));
    if (shouldSteal(holder, isRunning, Date.now())) {
      // Whoever wrote this is gone. Clear it and race for it like everybody else.
      rmSync(LOCK_PATH, { force: true });
      continue;
    }

    const waited = Date.now() - startedWaiting;
    if (holder && waited - saidAt >= SAY_EVERY_MS) {
      saidAt = waited;
      process.stderr.write(`${describeHolder(holder, waited)}\n`);
    }

    await new Promise((wake) => setTimeout(wake, POLL_MS));
  }
}

/** One attempt at creating the lock file, which is atomic or it is nothing. */
function take(): boolean {
  try {
    const file = openSync(LOCK_PATH, "wx");
    writeSync(
      file,
      JSON.stringify({ pid: process.pid, since: Date.now(), what: command.join(" ") })
    );
    closeSync(file);

    return true;
  } catch {
    return false;
  }
}

function readQuietly(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** The command itself, with its output left exactly where it was going. */
function run(): Promise<number> {
  return new Promise((done) => {
    const child = spawn(command[0], command.slice(1), { stdio: "inherit", shell: false });
    child.on("error", (error) => {
      process.stderr.write(`gate: could not run ${command[0]}: ${error.message}\n`);
      done(127);
    });
    child.on("exit", (code, signal) => done(signal ? 128 : (code ?? 1)));
  });
}
