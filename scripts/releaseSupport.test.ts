import { describe, expect, it } from "vitest";
import { describeGitFailure, settleExport, settleStep } from "./releaseSupport";

/**
 * The two things that stranded v0.5.2.
 *
 * The release script committed the version bump and then died at the push, leaving both manifests
 * at the new version with no tag and nothing on the remote - and re-running made it worse, because
 * the tree was then clean at the already-bumped version and the next run bumped again.
 *
 * The push failed because the bead export gate aborts the first push on main when the committed
 * export is stale, by design: a pre-push hook cannot amend the refs git has already computed, so it
 * commits the refresh and says to push again. The release script did not push again, and its git
 * helper piped the output, so the gate's explanation went into a buffer nobody read.
 *
 * So the export is settled before anything is at stake, and a git failure says what it was.
 */

describe("settleStep", () => {
  it("pushes when the gate committed a refresh, so the release's own push meets nothing", () => {
    // Non-zero is the gate saying "I committed the refresh and stopped this push". That commit is
    // local, and it has to reach the remote before the release commit is made on top of it.
    expect(settleStep(1)).toBe("push");
  });

  it("does nothing when the export was already current", () => {
    expect(settleStep(0)).toBe("none");
  });
});

describe("settleExport", () => {
  it("asks for a push when the gate committed a refresh", () => {
    expect(settleExport(() => 1)).toEqual({ action: "push" });
  });

  it("asks for nothing when the export was already current", () => {
    expect(settleExport(() => 0)).toEqual({ action: "none" });
  });

  it("reports a gate that threw, rather than letting it crash the release", () => {
    // The gate guards itself only on its command-line path; called as a function it can throw. A
    // stack trace here would be the same failure this bead exists to remove - except now the
    // release dies before the bump instead of after it, which is luck rather than design.
    const settled = settleExport(() => {
      throw new Error("dolt is not answering");
    });

    expect(settled).toEqual({ problem: expect.stringContaining("dolt is not answering") });
  });

  it("names the export gate in what it reports, so the cause is not a mystery", () => {
    const settled = settleExport(() => {
      throw new Error("boom");
    });

    expect("problem" in settled && settled.problem).toMatch(/export/iu);
  });
});

describe("describeGitFailure", () => {
  it("names the command that failed, not just that something did", () => {
    const said = describeGitFailure(["push", "origin", "HEAD:main"], new Error("boom"));
    expect(said).toContain("git push origin HEAD:main");
  });

  it("carries what git said on both streams, which is where hooks talk", () => {
    // The gate writes its "push again" explanation to stderr. Piped and dropped, the release looked
    // like an unexplained crash; this is the whole reason v0.5.2 was a mystery for a while.
    const failure = Object.assign(new Error("Command failed"), {
      stdout: "Everything up-to-date\n",
      stderr: "beads: nothing was pushed - run the push again to send it along.\n"
    });

    const said = describeGitFailure(["push", "origin", "main"], failure);
    expect(said).toContain("run the push again");
    expect(said).toContain("Everything up-to-date");
  });

  it("survives an error that carries nothing but a message", () => {
    expect(describeGitFailure(["tag", "v1.2.3"], new Error("nope"))).toContain("nope");
    expect(describeGitFailure(["tag", "v1.2.3"], "not an error at all")).toContain("not an error");
  });

  it("quotes an argument that carries spaces, so the line can be pasted back", () => {
    // `git commit -m Release v0.5.2` is a different command from the one that failed, and a reader
    // copying it back finds that out the hard way.
    const said = describeGitFailure(["commit", "-m", "Release v0.5.2"], new Error("nope"));

    expect(said).toContain('git commit -m "Release v0.5.2"');
  });

  it("leaves ordinary arguments unquoted, which is how anyone would type them", () => {
    expect(describeGitFailure(["push", "origin", "main"], new Error("x"))).toContain(
      "git push origin main"
    );
  });

  it("does not repeat the same text twice when a stream duplicates the message", () => {
    const failure = Object.assign(new Error("rejected"), { stdout: "", stderr: "rejected" });
    const said = describeGitFailure(["push"], failure);

    expect(said.split("rejected")).toHaveLength(2);
  });
});
