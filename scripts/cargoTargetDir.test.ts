import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One build directory for every worktree.
 *
 * Each git worktree used to compile into its own `target/`: three of them held 16.4 GB between them
 * for one repository, on a disk that reached 100% capacity - and an ENOSPC part-way through a build
 * surfaces as a strange linker error that reads like a code problem.
 *
 * Cargo searches for `.cargo/config.toml` upward from the working directory, and `build.target-dir`
 * in it is resolved against the directory holding the config. The worktrees live under
 * `.claude/worktrees/`, inside the repository, so the repository's own config catches them and they
 * all resolve to the one tree at the root. Measured, with the control: without the config a
 * worktree answered `.claude/worktrees/task/target`, and with it `<repo>/target`.
 *
 * What is asserted here is the one property that would break the build elsewhere. An absolute path
 * would work on the machine it was written on and fail on CI, which builds on Linux and caches
 * `target/` by its default location - so a well-meant `/Users/someone/.cache/...` would take the
 * Rust job down and leave the cache pointing at nothing.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(REPO, ".cargo", "config.toml");

/** Where the agents' worktrees live, relative to the repository root. */
const AGENT_WORKSPACES = ".claude";

/** One separator, so a comparison is about the path rather than about the platform. */
function normalise(path: string): string {
  return resolve(path).split(sep).join("/");
}

/** The value of `build.target-dir`, or nothing when the config does not set one. */
function targetDir(text: string): string | null {
  const match = text.match(/^\s*target-dir\s*=\s*"([^"]*)"/mu);

  return match ? match[1] : null;
}

describe("the shared cargo build directory", () => {
  it("is configured at the repository root, where every worktree's search reaches it", () => {
    expect(existsSync(CONFIG)).toBe(true);
    expect(targetDir(readFileSync(CONFIG, "utf8"))).toBe("target");
  });

  it("names a relative path, because an absolute one would only work on one machine", () => {
    const configured = targetDir(readFileSync(CONFIG, "utf8"));
    // Thrown rather than expected: `not.toBeNull()` does not stop the test, so a null would reach
    // isAbsolute below and fail there instead, with a message about the wrong thing.
    if (configured === null) {
      throw new Error("the cargo config sets no build.target-dir at all");
    }

    expect(isAbsolute(configured)).toBe(false);
    expect(configured).not.toContain("~");
  });

  it("keeps the worktrees inside the repository, which is what puts them under the config", () => {
    // A worktree moved elsewhere would silently get its own build directory again - and, worse,
    // its own empty bead database, since bd finds that by walking up too.
    const listed = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: REPO,
      encoding: "utf8"
    });
    // git reports paths with forward slashes on every platform, including Windows, where the repo
    // is built for release - so both sides are normalised before they are compared at all.
    const paths = [...listed.matchAll(/^worktree (.+)$/gmu)].map((match) => normalise(match[1]));
    const root = normalise(REPO);
    const inside = `${root}/${AGENT_WORKSPACES}`;
    const strays = paths.filter((path) => path !== root && !path.startsWith(inside));

    expect(strays).toEqual([]);
  });
});
