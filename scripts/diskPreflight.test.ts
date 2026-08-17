import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FREE_SPACE_FLOOR_GB, describeReclaimable, describeSpace, hasHeadroom } from "./diskPreflight";

/**
 * The check an agent runs before taking on a bead.
 *
 * A build that runs out of disk does not say so: it fails inside the linker or the code generator,
 * with a message that reads like a fault in the code being compiled - and an agent will then try to
 * fix the code. This was not hypothetical; the disk reached 100% capacity with 2.0 GiB free while
 * three worktrees each kept their own build tree.
 *
 * So the failure is moved to the front, where it can be stated plainly, and the number is a
 * property rather than a literal sprinkled through a skill.
 */
describe("hasHeadroom", () => {
  it("refuses the floor exactly, which is already too little to build in", () => {
    expect(hasHeadroom(FREE_SPACE_FLOOR_GB)).toBe(false);
  });

  it("allows a disk with room to spare", () => {
    expect(hasHeadroom(FREE_SPACE_FLOOR_GB + 0.1)).toBe(true);
  });

  it("refuses the disk this was written for, which had two gigabytes left", () => {
    expect(hasHeadroom(2)).toBe(false);
  });

  it("refuses a disk that is entirely full rather than dividing by nothing", () => {
    expect(hasHeadroom(0)).toBe(false);
  });

  it("refuses a machine with room for less than one build tree", () => {
    // Per-worktree builds (ah-gdp): a fresh worktree's own tree runs ~3.5 GB at its observed
    // worst, plus the build the bead is about to run, plus a gigabyte of slack - the floor moved
    // from 5 to 8 to reflect that arithmetic rather than a shared tree's.
    expect(hasHeadroom(7.9)).toBe(false);
  });
});

describe("describeSpace", () => {
  it("says what is free and what was wanted, so the number is never a mystery", () => {
    const said = describeSpace(1.5);
    expect(said).toContain("1.5");
    expect(said).toContain(String(FREE_SPACE_FLOOR_GB));
  });

  // "names the build directory" moved: per-worktree builds (ah-gdp) mean there is no single
  // directory to name unconditionally any more - what fills the disk is now named by
  // describeReclaimable, below, once a tree is actually found.

  it("never rounds a refusal up into looking like a pass", () => {
    // 4.96 rounded to one decimal is "5.0", which would read as "5.0 GB free, below the 5 GB
    // floor" - a sentence that argues with itself exactly when someone needs to believe it.
    const said = describeSpace(4.96);
    expect(said).toContain("4.9");
    expect(said).not.toContain("5.0 GB free");
    expect(said).toContain("below");
  });
});

/**
 * What a refusal - or a pass - says about what could be reclaimed.
 *
 * Per-worktree builds (ah-gdp) mean the floor is refused by trees a sweep can remove, not by a
 * single shared one a `cargo clean` would empty. The line names how much and where the sweep is,
 * so the refusal is actionable rather than just a number.
 */
describe("describeReclaimable", () => {
  it("names the build trees that could be reclaimed, and where the sweep is", () => {
    const said = describeReclaimable([
      { path: "/repo/target", sizeGb: 3.5 },
      { path: "/repo/.cerebro/worktrees/a/target", sizeGb: 1.7 },
      { path: "/repo/.cerebro/worktrees/b/target", sizeGb: 1.1 }
    ]);

    expect(said).not.toBeNull();
    expect(said).toContain("6.3 GB");
    expect(said).toContain("3 build trees");
    expect(said).toContain(".claude/cerebro/scripts/prune-worktrees.sh");
  });

  it("says nothing about a single tree in the plural", () => {
    const said = describeReclaimable([{ path: "/repo/target", sizeGb: 3.5 }]);
    expect(said).toContain("1 build tree");
    expect(said).not.toContain("1 build trees");
  });

  it("says nothing when there is nothing to reclaim", () => {
    expect(describeReclaimable([])).toBeNull();
  });

  it("never rounds the reclaimable total up into overstating what is there", () => {
    // Same rule describeSpace already applies to free space: 6.36 rounded to "6.4 GB" promises
    // more than is actually reclaimable.
    const said = describeReclaimable([{ path: "/repo/target", sizeGb: 6.36 }]);
    expect(said).toContain("6.3 GB");
    expect(said).not.toContain("6.4 GB");
  });
});

describe("describeSpace with build trees to report", () => {
  it("appends the reclaimable line to a refusal, without changing the verdict wording", () => {
    const said = describeSpace(3.1, [{ path: "/repo/target", sizeGb: 6.3 }]);

    expect(said).toContain("below");
    expect(said).toContain("6.3 GB");
    expect(said).toContain(".claude/cerebro/scripts/prune-worktrees.sh");
  });

  it("appends the reclaimable line to a pass too - the sweep is worth running either way", () => {
    const said = describeSpace(20, [{ path: "/repo/target", sizeGb: 6.3 }]);

    expect(said).toContain("above");
    expect(said).toContain("6.3 GB");
  });

  it("appends nothing when no build trees were found", () => {
    const said = describeSpace(3.1, []);

    expect(said).not.toContain("build tree");
  });

  it("defaults to appending nothing when called with no trees at all", () => {
    // The three-arg call is additive; every existing call site keeps working unchanged.
    expect(describeSpace(3.1)).not.toContain("build tree");
  });
});

/**
 * The script as an agent runs it.
 *
 * A skill tells an implementation agent to check for room before taking a bead. Without an entry
 * point the file was importable and not runnable: `tsx scripts/diskPreflight.ts` printed nothing and
 * exited 0, which is the worst answer available - a silent success reads as headroom.
 */
describe("the preflight as a command", () => {
  it("says what it found, and succeeds while this disk has room", () => {
    const said = execFileSync(TSX, [SCRIPT], { encoding: "utf8", timeout: 20_000 });

    expect(said).toMatch(/GB free/u);
    expect(said).toContain(String(FREE_SPACE_FLOOR_GB));
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "diskPreflight.ts");
const TSX = join(HERE, "..", "node_modules", ".bin", "tsx");
