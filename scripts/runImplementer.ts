/**
 * The launcher that owns an implementer's loop.
 *
 * An implementer used to be a subagent, and a subagent has no next turn: when it emits its final
 * text the `Agent` call returns and the session is gone. Every asynchronous wait the harness offers
 * is built on "keep working, the notification re-invokes you later", which cannot hold for something
 * that has already ended - Cyclops armed one against PR #161's review, ended its turn, and the
 * review landed with nobody left to receive it.
 *
 * So an implementer is now its own top-level `claude` session, which can wait, and the loop lives
 * out here instead: one process per bead, started fresh, exiting when the bead is merged, relaunched
 * for as long as the go flag is set. "One bead per process" stops being a rule the agent has to keep
 * and becomes a property of how it is run.
 *
 *     scripts/run-implementer Cyclops        # in a terminal of its own
 *
 * The flags are the control surface, and Cerebro writes them:
 *
 *     .claude/implementers/<name>.go         # present: keep taking beads
 *     .claude/implementers/<name>.stop       # present: finish this bead, then leave
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Action = "launch" | "idle" | "exit";

/**
 * What the loop does next, given the flags as they stand right now.
 *
 * Read between beads and never during one: an implementer that is taken down mid-bead strands a
 * claim, a worktree and an open PR for somebody to unpick by hand, which is the whole reason
 * stopping means "finish first" here.
 */
export function nextAction(flags: { go: boolean; stop: boolean }): Action {
  // Stop first, so that a stop and a go present at once resolves to leaving. The two are written by
  // different hands - Cerebro sets go, the navigator may drop a stop in directly - so both at once
  // is a real state, and the other reading makes a stop flag unable to stop anything.
  if (flags.stop) {
    return "exit";
  }

  // No go flag idles rather than exits: the terminal stays open and the slot stays available, so
  // putting this implementer back to work costs Cerebro one `touch`.
  return flags.go ? "launch" : "idle";
}

/**
 * Where a named implementer's flags live.
 *
 * The name comes from a human typing it in a terminal and it reaches the filesystem, so it is
 * validated rather than trusted: `../main` would put a flag somewhere no sweep looks, and a stray
 * separator would write into the repository proper.
 */
export function flagPaths(repoRoot: string, name: string): { go: string; stop: string } {
  if (!/^[A-Za-z0-9_-]+$/u.test(name)) {
    throw new Error(
      `implementer name must be letters, digits, dashes or underscores - got "${name}"`
    );
  }

  const directory = join(repoRoot, ".claude", "implementers");
  return { go: join(directory, `${name}.go`), stop: join(directory, `${name}.stop`) };
}

/** The flags as they stand on disk, for `nextAction` to decide on. */
export function readFlags(paths: { go: string; stop: string }): { go: boolean; stop: boolean } {
  return { go: existsSync(paths.go), stop: existsSync(paths.stop) };
}

/**
 * The command that runs one bead.
 *
 * `--print --verbose` streams the work to the terminal the navigator is watching and exits when the
 * run is done, which is what lets this loop own the cadence. Interactive mode would sit at a prompt
 * for ever and never come back.
 */
export function launchCommand(name: string): string[] {
  return [
    "--agent",
    "implementer",
    "--name",
    name,
    "--permission-mode",
    "auto",
    "--print",
    "--verbose",
    `You are implementer ${name}. Load the implement-bead skill and take exactly one planned bead ` +
      `through to merged, then finish. Your launcher starts the next one.`
  ];
}

/** Clears a stop flag as the loop leaves, so the next session does not inherit the instruction. */
export function clearStop(paths: { stop: string }): void {
  rmSync(paths.stop, { force: true });
}

/** How long to idle between reads of the flags. Overridable so the tests are not slow. */
function pollMs(): number {
  const configured = Number(process.env.IMPLEMENTER_POLL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 15_000;
}

/**
 * How long to wait after a run that cannot have done any work.
 *
 * Two runs look like this and both would otherwise spin. A `claude` that dies on a bad flag or
 * missing auth returns in milliseconds. And an implementer that finds nothing planned says so and
 * exits within seconds, quite successfully - so relaunching on a zero exit alone would start a fresh
 * session every few seconds for as long as the queue stayed empty, which costs real money and fills
 * the navigator's terminal with the same non-event.
 */
function backoffMs(): number {
  return Math.min(pollMs() * 10, 60_000);
}

/**
 * Below this, a run did nothing worth relaunching for, whatever its exit code.
 *
 * A bead is tens of minutes: a claim, TDD, a local gate, a review and a CI watch. Nothing that ends
 * in under two minutes took a bead through to merged, so the only question left is how long to wait
 * before looking again.
 */
const SHORT_RUN_MS = 120_000;

function sleep(ms: number): void {
  // Synchronous on purpose: this loop has nothing else to do, and an async wait would need the
  // whole script restructured around a promise chain for no gain.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The repository this launcher belongs to.
 *
 * `--git-common-dir` answers the main `.git` from anywhere, including a worktree, which
 * `--show-toplevel` does not - the same distinction `prune-worktrees.sh` documents.
 */
function repositoryRoot(): string {
  const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: dirname(fileURLToPath(import.meta.url)),
    encoding: "utf8"
  }).trim();
  return dirname(commonDir);
}

/** The loop itself: read the flags, run one bead, read them again. Exported so it can be tested. */
export function runLoop(repoRoot: string, name: string): number {
  const paths = flagPaths(repoRoot, name);
  const say = (line: string) => process.stdout.write(`run-implementer: ${line}\n`);

  say(`${name} watching ${paths.go}`);

  for (;;) {
    const action = nextAction(readFlags(paths));

    if (action === "exit") {
      clearStop(paths);
      say(`${name} told to finish - leaving`);
      return 0;
    }

    if (action === "idle") {
      sleep(pollMs());
      continue;
    }

    say(`starting ${name} on one bead`);
    const startedAt = Date.now();
    const run = spawnSync("claude", launchCommand(name), { stdio: "inherit" });
    const elapsedMs = Date.now() - startedAt;

    // `error` rather than a status is `claude` never having started - not installed, not on PATH.
    // Reporting that as an exit code would send the reader looking for a fault in the agent.
    if (run.error) {
      say(`could not be started: ${run.error.message}`);
    } else if (run.status !== 0) {
      // Name the signal. A run killed by SIGINT is the navigator pressing Ctrl-C and a SIGKILL is
      // something else entirely, and "a signal" makes the two indistinguishable in the terminal
      // where this is read.
      say(`${name} exited with ${run.status ?? `signal ${run.signal ?? "unknown"}`}`);
    } else if (elapsedMs < SHORT_RUN_MS) {
      // Successful and far too quick to have merged anything: an empty queue, most likely.
      say(`${name} finished in ${Math.round(elapsedMs / 1000)}s without taking a bead`);
    } else {
      continue;
    }

    say(`waiting ${Math.round(backoffMs() / 1000)}s before looking again`);
    sleep(backoffMs());
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const [name, ...rest] = process.argv.slice(2);
  const repoIndex = rest.indexOf("--repo");
  const given = repoIndex === -1 ? undefined : rest[repoIndex + 1];

  // The arguments are checked before anything is asked of git. The other order looks harmless and
  // is not: running this with no name at all died inside `spawnSync` with a stack trace, because
  // the repository lookup happened first and git was not reachable.
  if (name === undefined || (repoIndex !== -1 && given === undefined)) {
    process.stderr.write("usage: scripts/run-implementer <name> [--repo <path>]\n");
    process.exit(2);
  }

  let repoRoot = given;
  if (repoRoot === undefined) {
    try {
      repoRoot = repositoryRoot();
    } catch {
      process.stderr.write("run-implementer: not in a git repository, or git is not on PATH\n");
      process.exit(1);
    }
  }

  process.exit(runLoop(repoRoot, name));
}
