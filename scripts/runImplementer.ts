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

import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
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
 * Every name an implementer may have.
 *
 * A closed set, not a suggestion. Cerebro works from this list — it picks the next unused name from
 * it and looks for running implementers by it — so an off-roster name starts a real agent that the
 * orchestrator never accounts for: it would hold a bead, open PRs and be invisible to every question
 * the navigator asks about the fleet.
 *
 * Single words, all of them, because the name goes into a file path and into a `pgrep` pattern, and
 * a space would need quoting in both.
 */
export const IMPLEMENTER_NAMES = [
  "Cyclops",
  "Storm",
  "Wolverine",
  "Rogue",
  "Gambit",
  "Nightcrawler",
  "Colossus",
  "Iceman",
  "Beast",
  "Jubilee",
  "Psylocke",
  "Bishop",
  "Phoenix",
  "Mystique",
  "Magneto"
] as const;

/**
 * The name exactly as the roster spells it, or an error naming the alternatives.
 *
 * **Exact, including case**, which looks unfriendly and is not. Folding `storm` to `Storm` would fix
 * the flag files and nothing else: the process keeps the argument it was given, so `pgrep` - which is
 * how Cerebro discovers who is running - answers `storm` while the flags say `Storm.go`, and the
 * orchestrator sees an implementer it has no flags for. Meanwhile the macOS filesystem is
 * case-insensitive, so `storm` and `Storm` really would share one set of flags, each consuming the
 * other's `.go`. Demanding the canonical spelling keeps the process, the flags and the roster saying
 * one thing; a wrong case is a typo, and typos are cheapest at the prompt.
 */
export function canonicalName(input: string): string {
  const given = input.trim();

  if (IMPLEMENTER_NAMES.includes(given as (typeof IMPLEMENTER_NAMES)[number])) {
    return given;
  }

  const misspelt = IMPLEMENTER_NAMES.find((name) => name.toLowerCase() === given.toLowerCase());
  if (misspelt !== undefined) {
    throw new Error(`"${given}" is spelt "${misspelt}" - names are case-sensitive here`);
  }

  throw new Error(
    `"${given}" is not an implementer. Names are X-Men, and the roster is closed:\n  ` +
      IMPLEMENTER_NAMES.join(", ")
  );
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
 * `--print` is what makes the run end, which is what lets this loop own the cadence - an interactive
 * session would sit at a prompt for ever and never come back. `stream-json` is what makes it
 * watchable; see the flag comment below for why the obvious `--verbose` is not enough.
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
    // Measured, not assumed: `--print` with the default text format prints only the final message,
    // so an hour-long bead shows nothing at all while it runs and `--verbose` does not change that.
    // `stream-json` emits every tool call as it happens, which `formatEvent` turns back into lines a
    // human can follow.
    "--output-format",
    "stream-json",
    `You are implementer ${name}. Load the implement-bead skill and take exactly one planned bead ` +
      `through to merged, then finish. Your launcher starts the next one.`
  ];
}

/**
 * Where an implementer's raw event stream is kept.
 *
 * Cerebro cannot reach a `--print` session: it appears in neither `claude agents --json` nor
 * `ListAgents`, so `SendMessage` has nothing to address. This file is what it reads instead, and it
 * is the only record of a run besides the terminal it scrolled past on.
 */
export function logPath(repoRoot: string, name: string): string {
  return `${flagPaths(repoRoot, name).go.replace(/\.go$/u, "")}.log`;
}

/** One line of a tool input, short enough to sit in a terminal beside everything else. */
function summarise(input: unknown): string {
  const values = typeof input === "object" && input !== null ? Object.values(input) : [];
  const first = values.find((value) => typeof value === "string") as string | undefined;
  const line = (first ?? "").split("\n")[0]?.trim() ?? "";
  return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

/**
 * One line of `stream-json` turned into something worth putting in front of a human, or null.
 *
 * Null is the common answer and that is deliberate: the probe emitted eight `system` events before
 * the first useful one, and printing everything buries the run's actual progress. Anything
 * unparseable is also null - stdout is not a contract, and a warning or a line split at a chunk
 * boundary must not take the launcher down in the middle of a bead.
 */
export function formatEvent(line: string): string | null {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof event !== "object" || event === null) {
    return null;
  }

  const { type, message } = event as { type?: unknown; message?: unknown };
  if (type !== "assistant" || typeof message !== "object" || message === null) {
    return null;
  }

  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return null;
  }

  const lines: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) {
      continue;
    }
    const { type: blockType, text, name, input } = block as Record<string, unknown>;

    if (blockType === "text" && typeof text === "string" && text.trim() !== "") {
      lines.push(text.trim().split("\n")[0] ?? "");
    } else if (blockType === "tool_use" && typeof name === "string") {
      lines.push(`→ ${name}: ${summarise(input)}`.trimEnd());
    }
  }

  return lines.length === 0 ? null : lines.join(" ");
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

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
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

/**
 * Runs one bead, streaming as it goes: the raw events to the log, the readable ones to the terminal.
 *
 * Still synchronous. `spawnSync` cannot pipe a live stream, so the child writes its stdout to the
 * log file directly - the launcher then reads what has been appended and prints the parts worth
 * seeing. That keeps the loop a plain sequence of statements rather than a promise chain, and the
 * log ends up complete even for the part of a run that scrolled past.
 */
function runOneBead(
  repoRoot: string,
  name: string,
  say: (line: string) => void,
  keepLog: boolean
): Promise<{ status: number | null; signal: NodeJS.Signals | null; error?: Error }> {
  let sink: ReturnType<typeof createWriteStream> | null = null;
  if (keepLog) {
    const log = logPath(repoRoot, name);
    mkdirSync(dirname(log), { recursive: true });
    sink = createWriteStream(log, { flags: "a" });
  }

  return new Promise((done) => {
    // stdout is piped so it can be split two ways; stderr is inherited, because a stack trace from
    // the agent belongs in front of the navigator unedited.
    const child = spawn("claude", launchCommand(name), { stdio: ["ignore", "pipe", "inherit"] });

    let pending = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      sink?.write(chunk);

      // A chunk is not a line: the last one is usually a fragment, and parsing it would throw away
      // an event or - before `formatEvent` learned to shrug - crash the launcher.
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";

      for (const line of lines) {
        const rendered = formatEvent(line);
        if (rendered !== null) {
          say(rendered);
        }
      }
    });

    child.on("error", (error) => {
      sink?.end();
      done({ status: null, signal: null, error });
    });

    child.on("close", (status, signal) => {
      sink?.end();
      done({ status, signal });
    });
  });
}

/** The loop itself: read the flags, run one bead, read them again. Exported so it can be tested. */
export async function runLoop(
  repoRoot: string,
  name: string,
  options: { keepLog?: boolean } = {}
): Promise<number> {
  const paths = flagPaths(repoRoot, name);
  const keepLog = options.keepLog ?? false;
  const say = (line: string) => process.stdout.write(`run-implementer: ${line}\n`);

  say(`${name} watching ${paths.go}`);
  if (keepLog) {
    say(`keeping every event in ${logPath(repoRoot, name)}`);
  }

  for (;;) {
    const action = nextAction(readFlags(paths));

    if (action === "exit") {
      clearStop(paths);
      say(`${name} told to finish - leaving`);
      return 0;
    }

    if (action === "idle") {
      await sleep(pollMs());
      continue;
    }

    say(`starting ${name} on one bead`);
    const startedAt = Date.now();
    const run = await runOneBead(repoRoot, name, say, keepLog);
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
    await sleep(backoffMs());
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
    process.stderr.write("usage: scripts/run-implementer <name> [--log] [--repo <path>]\n");
    process.exit(2);
  }

  // The roster is enforced here rather than deeper down, so a mistyped name costs a message at the
  // prompt instead of a running agent nobody is looking for.
  let implementer: string;
  try {
    implementer = canonicalName(name);
  } catch (error) {
    process.stderr.write(`run-implementer: ${error instanceof Error ? error.message : error}\n`);
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

  // `.then` rather than a top-level `await`: tsx transforms these scripts as CJS, where top-level
  // await is a build error rather than a runtime one - the launcher would not start at all.
  runLoop(repoRoot, implementer, { keepLog: rest.includes("--log") }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`run-implementer: ${error instanceof Error ? error.message : error}\n`);
      process.exit(1);
    }
  );
}
