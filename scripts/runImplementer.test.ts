import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  IMPLEMENTER_NAMES,
  canonicalName,
  flagPaths,
  formatEvent,
  launchCommand,
  logPath,
  nextAction
} from "./runImplementer";

/**
 * The launcher that owns an implementer's loop.
 *
 * An implementer used to be a subagent, and a subagent has no next turn: when it emits its final
 * text the `Agent` call returns and the session is gone. Cyclops armed a Monitor against PR #161's
 * review and ended its turn; the review landed with nobody left to receive it. So an implementer is
 * now its own top-level session - which can wait - and the loop moves out of the agent and into this
 * module, which the navigator runs in a terminal through the `scripts/run-implementer` wrapper. One
 * `claude` process per bead, started fresh, exiting when the bead is merged, relaunched for as long
 * as the go flag is set.
 *
 * These are the decisions that loop makes. They are pure functions taking their inputs as arguments,
 * following `gateLock.ts`, because a loop that reads the filesystem itself cannot be tested at all.
 */

describe("nextAction", () => {
  it("launches an implementer while the go flag is set", () => {
    expect(nextAction({ go: true, stop: false })).toBe("launch");
  });

  it("idles when the go flag is absent", () => {
    // Idle rather than exit: the terminal stays open and the slot stays available, so Cerebro can
    // put this implementer back to work by touching one file.
    expect(nextAction({ go: false, stop: false })).toBe("idle");
  });

  it("exits on the stop flag", () => {
    expect(nextAction({ go: false, stop: true })).toBe("exit");
  });

  it("lets stop win over go when both are set", () => {
    // The two flags are written by different hands - Cerebro sets go, the navigator may drop a stop
    // in by hand - so both being present is a real state and not a contradiction to reject. Stop is
    // the one that must be obeyed: the opposite reading makes a stop unable to stop anything.
    expect(nextAction({ go: true, stop: true })).toBe("exit");
  });
});

describe("flagPaths", () => {
  it("puts an implementer's flags under .claude/implementers, named for the agent", () => {
    expect(flagPaths("/repo", "Cyclops")).toEqual({
      go: "/repo/.claude/implementers/Cyclops.go",
      stop: "/repo/.claude/implementers/Cyclops.stop"
    });
  });

  it("refuses a name that would climb out of the flag directory", () => {
    // The name reaches the filesystem, and it comes from a human typing it in a terminal. A name of
    // `../../main` would put a `.stop` somewhere no sweep would ever look and, worse, let a typo
    // write into the repository proper.
    expect(() => flagPaths("/repo", "../escape")).toThrow(/name/iu);
  });

  it("refuses a name containing a path separator", () => {
    expect(() => flagPaths("/repo", "x/y")).toThrow(/name/iu);
  });

  it("refuses an empty name", () => {
    // Without this, the flags would be `.claude/implementers/.go` - a hidden file that reads as
    // "some implementer is running" to a human and belongs to none of them.
    expect(() => flagPaths("/repo", "")).toThrow(/name/iu);
  });

  it("accepts the X-Men names actually in use", () => {
    expect(flagPaths("/repo", "Nightcrawler").go).toBe(
      "/repo/.claude/implementers/Nightcrawler.go"
    );
  });
});

describe("canonicalName", () => {
  it("accepts a name from the roster", () => {
    expect(canonicalName("Cyclops")).toBe("Cyclops");
    expect(canonicalName("Nightcrawler")).toBe("Nightcrawler");
  });

  it("refuses a name that is not an X-Man", () => {
    // The roster is the whole set of implementers there can be. An off-roster name would start a
    // real agent that Cerebro never looks for, since it works from that list.
    expect(() => canonicalName("Wolverin")).toThrow(/Wolverin/u);
  });

  it("names the roster in the error, so the fix is in front of you", () => {
    expect(() => canonicalName("Batman")).toThrow(/Cyclops/u);
  });

  it("insists on the roster's own spelling, and says what it should have been", () => {
    // Folding the case would fix the flag files and nothing else: the process keeps the argument it
    // was given, so `pgrep` answers `storm` while the flags say `Storm.go` - and Cerebro, which
    // discovers implementers with pgrep, sees one it has no flags for. Measured, not assumed:
    // `run-implementer storm` really does show as `storm` in the process list.
    expect(() => canonicalName("storm")).toThrow(/spelt "Storm"/u);
    expect(() => canonicalName("MAGNETO")).toThrow(/case-sensitive/u);
  });

  it("ignores surrounding whitespace, which a shell can leave behind", () => {
    expect(canonicalName("  Rogue  ")).toBe("Rogue");
  });

  it("refuses an empty name and a path that would escape the flag directory", () => {
    expect(() => canonicalName("")).toThrow();
    expect(() => canonicalName("../escape")).toThrow();
  });

  it("offers fifteen names, all single words", () => {
    // Single words because the name goes into a file path and into a pgrep pattern; a space would
    // need quoting in every place either appears.
    expect(IMPLEMENTER_NAMES).toHaveLength(15);
    for (const name of IMPLEMENTER_NAMES) {
      expect(name).toMatch(/^[A-Za-z]+$/u);
    }
  });
});

describe("launchCommand", () => {
  it("runs the implementer agent in print mode so the run ends and the loop regains control", () => {
    // `--print` is the load-bearing flag: an interactive session would sit at a prompt for ever and
    // the launcher would never get to read the flags again. `--verbose` is what puts the work in
    // front of the navigator watching the terminal.
    const argv = launchCommand("Cyclops");
    expect(argv).toContain("--print");
    expect(argv).toContain("--verbose");
    expect(argv.join(" ")).toContain("--agent implementer");
    expect(argv.join(" ")).toContain("--name Cyclops");
  });

  it("asks for the streaming format, because text mode shows nothing until the run ends", () => {
    // Measured, not assumed: a 45-second run under `--print` with text output printed exactly one
    // line - the final message. An hour-long bead would show nothing at all while it worked, and
    // `--verbose` does not change that. `stream-json` emits each tool call as it happens.
    expect(launchCommand("Cyclops").join(" ")).toContain("--output-format stream-json");
  });

  it("tells the implementer to take exactly one bead", () => {
    // The loop belongs to the launcher now. An agent that took a second bead would rebuild the very
    // context growth that one-process-per-bead exists to prevent.
    expect(launchCommand("Cyclops").at(-1)).toMatch(/exactly one/iu);
  });
});

describe("formatEvent", () => {
  const assistant = (content: unknown[]) =>
    JSON.stringify({ type: "assistant", message: { content } });

  it("shows what the implementer said", () => {
    expect(formatEvent(assistant([{ type: "text", text: "Claiming ah-t65" }]))).toBe(
      "Claiming ah-t65"
    );
  });

  it("names the tool being used, so a long run reads as progress", () => {
    const line = formatEvent(
      assistant([{ type: "tool_use", name: "Bash", input: { command: "pnpm run test" } }])
    );
    expect(line).toContain("Bash");
    expect(line).toContain("pnpm run test");
  });

  it("keeps a long tool input to one line", () => {
    // The terminal is the navigator's window onto an hour of work. A tool call pasting forty lines
    // of a file into it buries the next thing that matters.
    const line = formatEvent(
      assistant([{ type: "tool_use", name: "Write", input: { content: "a\nb\nc".repeat(200) } }])
    );
    expect(line?.split("\n")).toHaveLength(1);
    expect(line!.length).toBeLessThan(200);
  });

  it("says nothing about events with nothing to show", () => {
    // Eight `system` events arrived before the first useful line in the probe. Printing them would
    // bury the run's actual first step.
    expect(formatEvent(JSON.stringify({ type: "system", subtype: "init" }))).toBeNull();
  });

  it("survives a line that is not JSON at all", () => {
    // stdout is not a contract. A warning, a partial line at a chunk boundary, or anything else the
    // CLI decides to print must not take the launcher down mid-bead.
    expect(() => formatEvent("Warning: something happened")).not.toThrow();
    expect(formatEvent("Warning: something happened")).toBeNull();
  });

  it("survives JSON that is not shaped like an event", () => {
    expect(formatEvent(JSON.stringify({ type: "assistant" }))).toBeNull();
    expect(formatEvent("null")).toBeNull();
  });
});

describe("logPath", () => {
  it("puts an implementer's transcript beside its flags", () => {
    // Cerebro cannot reach a print-mode session with SendMessage - it does not even appear in
    // `claude agents`. This file is what it reads instead.
    expect(logPath("/repo", "Cyclops")).toBe("/repo/.claude/implementers/Cyclops.log");
  });
});

/**
 * The loop, as a process.
 *
 * `gateLock.test.ts` already spawns real processes, so this is an established cost rather than a new
 * one - and the behaviour under test is precisely what a pure function cannot show: that the script
 * re-reads the flags between runs and launches again.
 */
describe("the launcher loop", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const launcher = join(here, "runImplementer.ts");
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  /** A workspace with a stubbed `claude` on PATH that records each invocation and exits at once. */
  function workspace(claudeBody: string) {
    const root = mkdtempSync(join(tmpdir(), "run-implementer-"));
    workspaces.push(root);

    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(root, ".claude", "implementers"), { recursive: true });

    const log = join(root, "invocations.log");
    writeFileSync(
      join(bin, "claude"),
      // `/bin/bash` absolute, not `/usr/bin/env bash`: PATH holds only this directory, so `env`
      // would have nowhere to look for bash.
      `#!/bin/bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n${claudeBody}\n`,
      { mode: 0o755 }
    );

    return { root, log, flags: flagPaths(root, "Cyclops") };
  }

  function start(
    root: string,
    bin: string,
    stdio: "ignore" | "pipe" = "ignore",
    extra: string[] = []
  ) {
    // `process.execPath` with the tsx loader rather than `npx`: an absolute node path needs no PATH
    // at all, which is what lets the missing-`claude` case below run with an empty one.
    const argv = ["--import", "tsx", launcher, "Cyclops", "--repo", root, ...extra];
    return spawn(process.execPath, argv, {
      cwd: dirname(launcher),
      env: { PATH: bin, IMPLEMENTER_POLL_MS: "50", HOME: process.env.HOME ?? "" },
      stdio
    });
  }

  function invocations(log: string): string[] {
    return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
  }

  async function until(predicate: () => boolean, timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  it("starts a fresh implementer for each bead while the go flag is set", async () => {
    const { root, log, flags } = workspace("exit 0");
    writeFileSync(flags.go, "");
    const child = start(root, join(root, "bin"));

    try {
      // Two invocations is the whole claim: the first bead's process exited and the launcher, not
      // the agent, decided there should be another.
      expect(await until(() => invocations(log).length >= 2)).toBe(true);
    } finally {
      child.kill();
    }
  }, 30_000);

  it("stops launching once the go flag is removed", async () => {
    const { root, log, flags } = workspace("exit 0");
    writeFileSync(flags.go, "");
    const child = start(root, join(root, "bin"));

    try {
      await until(() => invocations(log).length >= 1);
      rmSync(flags.go);
      const settled = invocations(log).length;
      await new Promise((resolve) => setTimeout(resolve, 600));
      // Idling, not exiting: the terminal stays open so Cerebro can put it back to work.
      expect(invocations(log).length).toBeLessThanOrEqual(settled + 1);
    } finally {
      child.kill();
    }
  }, 30_000);

  it("exits on the stop flag and clears it, so the next session does not inherit it", async () => {
    const { root, log, flags } = workspace("exit 0");
    writeFileSync(flags.stop, "");
    const child = start(root, join(root, "bin"));

    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));

    expect(code).toBe(0);
    expect(existsSync(flags.stop)).toBe(false);
    expect(invocations(log)).toHaveLength(0);
  }, 30_000);

  it("backs off when a run returns too fast to have been a bead", async () => {
    // The dry-queue case, and it costs real money. An implementer that finds nothing planned says so
    // and exits within seconds - so a launcher that relaunches on success alone would start a fresh
    // `claude` session every few seconds for as long as the queue stayed empty. A real bead is tens
    // of minutes; anything shorter did no work, whatever its exit code.
    const { root, log, flags } = workspace("exit 0");
    writeFileSync(flags.go, "");
    const child = start(root, join(root, "bin"));

    try {
      await until(() => invocations(log).length >= 1);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(invocations(log).length).toBeLessThan(5);
    } finally {
      child.kill();
    }
  }, 30_000);

  it("writes no log unless asked, so a long-running implementer does not fill the disk", async () => {
    // One bead produced a megabyte, and the launcher appends across runs - an implementer left going
    // overnight would write hundreds of them. The events are on the navigator's terminal either way,
    // so keeping the file is the exception rather than the rule.
    const { root, flags } = workspace("exit 0");
    writeFileSync(flags.go, "");
    const child = start(root, join(root, "bin"));

    try {
      await until(() => existsSync(logPath(root, "Cyclops")), 3_000);
      expect(existsSync(logPath(root, "Cyclops"))).toBe(false);
    } finally {
      child.kill();
    }
  }, 30_000);

  it("writes the raw stream to the implementer's log when --log is given", async () => {
    const event = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "taking ah-t65" }] }
    });
    const { root, flags } = workspace(`printf '%s\\n' ${JSON.stringify(event)}\nexit 0`);
    writeFileSync(flags.go, "");
    const child = start(root, join(root, "bin"), "ignore", ["--log"]);

    try {
      const log = logPath(root, "Cyclops");
      expect(await until(() => existsSync(log) && readFileSync(log, "utf8").includes("ah-t65"))).toBe(
        true
      );
    } finally {
      child.kill();
    }
  }, 30_000);

  it("prints usage rather than a stack trace when given no name", async () => {
    // It used to look up the repository before checking the arguments, so `run-implementer` with no
    // name died inside spawnSync with a raw ErrnoException - the reader's first thought being that
    // the launcher was broken rather than that they had mistyped.
    const child = spawn(process.execPath, ["--import", "tsx", launcher], {
      cwd: dirname(launcher),
      env: { PATH: "", HOME: process.env.HOME ?? "" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));

    expect(output).toMatch(/usage: scripts\/run-implementer/u);
    expect(output).not.toMatch(/ErrnoException|at Object\./u);
    expect(code).toBe(2);
  }, 30_000);

  it("says the command could not be started when claude is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "run-implementer-"));
    workspaces.push(root);
    mkdirSync(join(root, ".claude", "implementers"), { recursive: true });
    const flags = flagPaths(root, "Cyclops");
    writeFileSync(flags.go, "");

    // An empty PATH directory: `claude` cannot be found at all, which is spawnSync's `error` case
    // rather than a non-zero status - and "exited with no status" would be a baffling thing to read
    // when the real answer is that the tool is not installed.
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const child = start(root, bin, "pipe");

    let output = "";
    // Optional: `start` types its streams as nullable because its stdio mode is a parameter.
    child.stdout?.on("data", (chunk) => (output += String(chunk)));
    child.stderr?.on("data", (chunk) => (output += String(chunk)));

    try {
      expect(await until(() => /could not be started|not found|ENOENT/iu.test(output))).toBe(true);
    } finally {
      child.kill();
    }
  }, 30_000);

  it("backs off instead of spinning when the implementer fails immediately", async () => {
    // A `claude` that dies on a bad flag or missing auth returns in milliseconds. Without a backoff
    // the loop would relaunch thousands of times a minute and fill the terminal with the same
    // failure - the navigator would see noise rather than the one line that matters.
    const { root, log, flags } = workspace("exit 1");
    writeFileSync(flags.go, "");
    const child = start(root, join(root, "bin"));

    try {
      await until(() => invocations(log).length >= 1);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(invocations(log).length).toBeLessThan(5);
    } finally {
      child.kill();
    }
  }, 30_000);
});
