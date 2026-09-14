import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  changedPaths,
  classifyPaths,
  decideWorkload,
  describeWorkload,
  interpretClassifier,
  planLegs
} from "./gateWorkload";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  // realpathSync: macOS temp dirs are symlinks, and git reports the other spelling.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-workload-")));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A throwaway repository with a seed commit and, unless asked otherwise, origin/main at it. */
function createRepo(withBase = true): string {
  const root = tempDir();
  execFileSync("git", ["init", "--initial-branch=main", root], { stdio: "ignore" });
  git(root, ["config", "user.email", "root@example.com"]);
  git(root, ["config", "user.name", "Root Test"]);
  writeFileSync(join(root, "seed.txt"), "seed");
  writeFileSync(join(root, "doomed.txt"), "doomed");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "seed"]);
  if (withBase) git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  return root;
}

describe("interpretClassifier", () => {
  it("reads non-rust", () => {
    expect(interpretClassifier({ status: 0, stdout: "non-rust\n" })).toEqual({
      workload: "non-rust",
      reason: "no changed path matches rust_paths"
    });
  });

  it("reads rust", () => {
    expect(interpretClassifier({ status: 0, stdout: "rust\n" })).toEqual({
      workload: "rust",
      reason: "a changed path matches rust_paths"
    });
  });

  it("fails closed on a non-zero exit", () => {
    expect(interpretClassifier({ status: 3, stdout: "" })).toEqual({
      workload: "rust",
      reason: "build-workload could not classify (exit 3)"
    });
  });

  it("fails closed on a null status", () => {
    expect(interpretClassifier({ status: null, stdout: "non-rust\n" })).toEqual({
      workload: "rust",
      reason: "build-workload could not classify (exit null)"
    });
  });
});

describe("planLegs", () => {
  const legs = [{ name: "lint" }, { name: "fmt", rust: true }, { name: "clippy", rust: true }];

  it("skips exactly the rust legs for a non-rust workload, in order", () => {
    const planned = planLegs(legs, "non-rust");
    expect(planned.map((entry) => entry.leg.name)).toEqual(["lint", "fmt", "clippy"]);
    expect(planned.map((entry) => entry.skip)).toEqual([false, true, true]);
  });

  it("skips nothing for a rust workload", () => {
    expect(planLegs(legs, "rust").map((entry) => entry.skip)).toEqual([false, false, false]);
  });
});

describe("describeWorkload", () => {
  it("says every leg runs for rust", () => {
    expect(
      describeWorkload({ workload: "rust", reason: "a changed path matches rust_paths" }, [])
    ).toBe("workload: rust (a changed path matches rust_paths) - every leg runs.");
  });

  it("names what it skips for non-rust", () => {
    expect(
      describeWorkload({ workload: "non-rust", reason: "no changed path matches rust_paths" }, [
        "fmt",
        "clippy"
      ])
    ).toBe(
      "workload: non-rust (no changed path matches rust_paths) - skipping fmt, clippy, and the cargo suite inside test; CI's rust job runs them."
    );
  });
});

describe("decideWorkload", () => {
  it("honours a forced rust without touching git", () => {
    expect(decideWorkload({ ATLANTIS_GATE_WORKLOAD: "rust" }, tempDir())).toEqual({
      workload: "rust",
      reason: "forced by ATLANTIS_GATE_WORKLOAD=rust"
    });
  });

  it("runs everything when nothing changed against origin/main", () => {
    expect(decideWorkload({}, createRepo())).toEqual({
      workload: "rust",
      reason: "no changed paths against origin/main"
    });
  });

  it("runs everything when there is no base to diff against", () => {
    expect(decideWorkload({ ATLANTIS_GATE_WORKLOAD: "non-rust" }, createRepo(false))).toEqual({
      workload: "rust",
      reason: "could not list the changed paths against origin/main"
    });
  });
});

describe("changedPaths", () => {
  it("lists committed, unstaged and untracked changes, sorted", () => {
    const root = createRepo();
    writeFileSync(join(root, "committed.txt"), "c");
    git(root, ["add", "committed.txt"]);
    git(root, ["commit", "-m", "after base"]);
    writeFileSync(join(root, "seed.txt"), "edited");
    writeFileSync(join(root, "untracked.txt"), "u");

    expect(changedPaths(root)).toEqual(["committed.txt", "seed.txt", "untracked.txt"]);
  });

  it("lists a deleted file", () => {
    const root = createRepo();
    unlinkSync(join(root, "doomed.txt"));

    expect(changedPaths(root)).toEqual(["doomed.txt"]);
  });

  it("lists both sides of a rename, so a file moved out of a Rust path still counts", () => {
    const root = createRepo();
    mkdirSync(join(root, "crates"));
    writeFileSync(join(root, "crates", "lib.rs"), "fn main() {}\n".repeat(20));
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "crate"]);
    git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    git(root, ["mv", "crates/lib.rs", "moved.rs"]);
    git(root, ["commit", "-m", "move"]);

    expect(changedPaths(root)).toEqual(["crates/lib.rs", "moved.rs"]);
  });

  it("is undefined with no origin/main", () => {
    expect(changedPaths(createRepo(false))).toBeUndefined();
  });
});

/**
 * The real classifier lives in the cerebro submodule, which CI's checkout does not fetch (see
 * scripts/verificationSkill.test.ts). Where it is absent these two cases are skipped rather than
 * failed: the fallback they would then observe is decideWorkload's fail-closed rust, tested above.
 */
const BUILD_WORKLOAD = join(process.cwd(), ".claude", "cerebro", "scripts", "build-workload");

describe.skipIf(!existsSync(BUILD_WORKLOAD))("classifyPaths", () => {
  it("classifies a TypeScript-only change as non-rust", () => {
    expect(classifyPaths(["packages/shared/src/x.ts"], process.cwd()).workload).toBe("non-rust");
  });

  it("classifies a change touching a crate as rust", () => {
    expect(
      classifyPaths(["packages/shared/src/x.ts", "crates/core/src/lib.rs"], process.cwd()).workload
    ).toBe("rust");
  });
});
