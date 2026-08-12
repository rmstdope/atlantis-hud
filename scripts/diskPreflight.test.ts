import { describe, expect, it } from "vitest";
import { FREE_SPACE_FLOOR_GB, describeSpace, hasHeadroom } from "./diskPreflight";

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
});

describe("describeSpace", () => {
  it("says what is free and what was wanted, so the number is never a mystery", () => {
    const said = describeSpace(1.5);
    expect(said).toContain("1.5");
    expect(said).toContain(String(FREE_SPACE_FLOOR_GB));
  });

  it("names the build directory, which is the thing that fills the disk", () => {
    expect(describeSpace(1.5)).toContain("target");
  });

  it("never rounds a refusal up into looking like a pass", () => {
    // 4.96 rounded to one decimal is "5.0", which would read as "5.0 GB free, below the 5 GB
    // floor" - a sentence that argues with itself exactly when someone needs to believe it.
    const said = describeSpace(4.96);
    expect(said).toContain("4.9");
    expect(said).not.toContain("5.0 GB free");
    expect(said).toContain("below");
  });
});
