import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalize, strayWorktrees, targetDir } from "./cargoTargetDir";

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
    const strays = strayWorktrees(listed, REPO);

    expect(strays).toEqual([]);
    // The repository itself and the agents' worktrees are what this is about, so a run that saw
    // neither would pass while asserting nothing.
    expect(listed).toContain(`worktree ${normalize(REPO)}`);
  });
});
