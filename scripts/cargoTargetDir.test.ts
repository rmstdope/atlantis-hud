import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalize, repositoryRoot, strayWorktrees, targetDir } from "./cargoTargetDir";

/**
 * One build directory for every worktree.
 *
 * Each git worktree used to compile into its own `target/`: three of them held 16.4 GB between them
 * for one repository, on a disk that reached 100% capacity - and an ENOSPC part-way through a build
 * surfaces as a strange linker error that reads like a code problem.
 *
 * Cargo searches for `.cargo/config.toml` upward from the working directory, and `build.target-dir`
 * in it is resolved against the directory holding the config. The worktrees live under
 * `.cerebro/worktrees/`, inside the repository, so the repository's own config catches them and they
 * all resolve to the one tree at the root. Measured, with the control: without the config a
 * worktree answered `.cerebro/worktrees/task/target`, and with it `<repo>/target`.
 *
 * What is asserted here is the one property that would break the build elsewhere. An absolute path
 * would work on the machine it was written on and fail on CI, which builds on Linux and caches
 * `target/` by its default location - so a well-meant `/Users/someone/.cache/...` would take the
 * Rust job down and leave the cache pointing at nothing.
 *
 * The "inside the repository" check below is asked of this worktree only, on purpose: it used to
 * ask about every worktree on the machine, which let one session's scratch worktree redden every
 * other session's gate (ah-efj).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = repositoryRoot(HERE);
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

  it("runs from a worktree inside the repository, where the config and the bead database are shared", () => {
    // Asked of THIS worktree only. The machine's other worktrees are other sessions' business - a
    // scratch tree elsewhere used to redden every session's gate (ah-efj). What matters for the
    // branch under test is that its own tree finds the repository's cargo config and bead database.
    const here = execFileSync("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], {
      cwd: HERE,
      encoding: "utf8"
    }).trimEnd();

    expect(strayWorktrees(`worktree ${here}\n`, REPO)).toEqual([]);
  });
});

describe("repositoryRoot", () => {
  it("answers the same path from a worktree as from the checkout it belongs to", () => {
    const root = createRepo();
    const worktree = join(root, ".cerebro", "worktrees", "example");
    git(root, ["worktree", "add", "-b", "example", worktree]);

    expect(repositoryRoot(root)).toBe(root);
    expect(repositoryRoot(worktree)).toBe(root);
  });
});

describe("strayWorktrees", () => {
  const root = "/repo";

  it("does not flag the root itself", () => {
    expect(strayWorktrees(`worktree ${root}\n`, root)).toEqual([]);
  });

  it("does not flag a worktree under the agents' directory", () => {
    const inside = `${root}/.cerebro/worktrees/x`;
    expect(strayWorktrees(`worktree ${root}\nworktree ${inside}\n`, root)).toEqual([]);
  });

  it("flags a sibling directory merely named after the agents' directory", () => {
    // The trailing separator is the whole guard: without it `.cerebro-old` starts with `.cerebro`
    // and would pass as though it were inside.
    const lookalike = `${root}/.cerebro-old/x`;
    expect(strayWorktrees(`worktree ${root}\nworktree ${lookalike}\n`, root)).toEqual([lookalike]);
  });

  it("flags a worktree outside the repository entirely", () => {
    const outside = "/elsewhere/x";
    expect(strayWorktrees(`worktree ${root}\nworktree ${outside}\n`, root)).toEqual([outside]);
  });

  it("normalizes a path built with the platform separator, so the comparison is about the path rather than the platform", () => {
    // `normalize` exists so a path `resolve` assembled with the platform's own separator (`\` on
    // Windows) compares equal to one git reported directly, since git always reports forward
    // slashes, on Windows too. `sep` is already "/" on this platform, so this pins normalize's
    // idempotence rather than exercising a real backslash - the cross-platform conversion itself
    // needs a Windows machine to observe.
    const built = ["", "repo", ".cerebro", "worktrees", "x"].join(sep);
    const inside = normalize(built);
    expect(strayWorktrees(`worktree ${root}\nworktree ${inside}\n`, root)).toEqual([]);
  });
});

describe("the stray check, end to end", () => {
  it("reports a worktree outside the repository as a stray", () => {
    const root = createRepo();
    const inside = join(root, ".cerebro", "worktrees", "example");
    git(root, ["worktree", "add", "-b", "example", inside]);

    const outsideParent = realpathSync(mkdtempSync(join(tmpdir(), "cargo-target-dir-outside-")));
    const outside = join(outsideParent, "example");
    git(root, ["worktree", "add", "-b", "example-outside", outside]);

    const listed = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: root,
      encoding: "utf8"
    });

    expect(strayWorktrees(listed, root)).toEqual([normalize(outside)]);
  });
});

/** A throwaway repository with a seed commit, so `git worktree add` has something to branch from. */
function createRepo(): string {
  // realpathSync: mkdtempSync hands back one spelling of /tmp and git hands back the other
  // (/private/tmp on macOS), which fails a comparison between them for reasons that have nothing
  // to do with the code under test.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cargo-target-dir-root-")));
  execFileSync("git", ["init", "--initial-branch=main", root]);
  git(root, ["config", "user.email", "root@example.com"]);
  git(root, ["config", "user.name", "Root Test"]);
  writeFileSync(join(root, "seed.txt"), "seed");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "seed"]);

  return root;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
