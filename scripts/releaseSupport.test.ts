import { describe, expect, it } from "vitest";
import { describeGitFailure, finishRelease, recoveryAdvice } from "./releaseSupport";

describe("describeGitFailure", () => {
  it("names the command that failed, not just that something did", () => {
    const said = describeGitFailure(["push", "origin", "HEAD:main"], new Error("boom"));
    expect(said).toContain("git push origin HEAD:main");
  });

  it("carries what git said on both streams, which is where hooks talk", () => {
    const failure = Object.assign(new Error("Command failed"), {
      stdout: "Everything up-to-date\n",
      stderr: "! [rejected]        main -> main (fetch first)\n"
    });

    const said = describeGitFailure(["push", "origin", "main"], failure);
    expect(said).toContain("rejected");
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

describe("recoveryAdvice", () => {
  it("names the commands to run when nothing was pushed", () => {
    const lines = recoveryAdvice({
      tag: "v0.5.4",
      branch: "main",
      releaseCommit: "c24a8ba",
      versionCommitPushed: false,
      tagCreated: false,
      tagPushed: false
    });

    expect(lines.join("\n")).toContain("git push origin HEAD:main");
    expect(lines.join("\n")).toContain("git tag v0.5.4 c24a8ba");
    expect(lines.join("\n")).toContain("git push origin v0.5.4");
  });

  it("names only the tag steps when the version commit already reached the remote", () => {
    const lines = recoveryAdvice({
      tag: "v0.5.4",
      branch: "main",
      releaseCommit: "c24a8ba",
      versionCommitPushed: true,
      tagCreated: false,
      tagPushed: false
    });

    expect(lines.join("\n")).not.toContain("git push origin HEAD:main");
    expect(lines.join("\n")).toContain("git tag v0.5.4 c24a8ba");
  });

  it("names only the tag push when the tag was made but not pushed", () => {
    const lines = recoveryAdvice({
      tag: "v0.5.4",
      branch: "main",
      releaseCommit: "c24a8ba",
      versionCommitPushed: true,
      tagCreated: true,
      tagPushed: false
    });

    expect(lines.join("\n")).not.toContain("git tag v0.5.4");
    expect(lines.join("\n")).toContain("git push origin v0.5.4");
  });

  it("tags the release commit, not HEAD, so a pasted recovery cannot land on a refresh commit", () => {
    // The bug this once fixed: `git tag <name>` with no second argument tags HEAD, which could be a
    // commit made after the release commit by the time a human ran it.
    const lines = recoveryAdvice({
      tag: "v0.5.4",
      branch: "main",
      releaseCommit: "c24a8ba",
      versionCommitPushed: true,
      tagCreated: false,
      tagPushed: false
    });

    expect(lines).toContain("git tag v0.5.4 c24a8ba");
  });
});

/**
 * The invariant this once guarded against a bead-export refresh landing mid-release: the tag is
 * created on the commit recorded before any push ran, never on whatever HEAD happens to be by the
 * time the pushes are done.
 */
describe("finishRelease", () => {
  it("creates the tag on the commit recorded before the pushes, even if HEAD moved", () => {
    let head = "c24a8ba";
    const calls: string[] = [];

    const pushBranch = () => {
      calls.push("pushBranch");
      // Simulates something else committing on top of HEAD during the branch push.
      head = "b757b1d";
      return { ok: true, output: "" };
    };
    const pushTag = () => {
      calls.push("pushTag");
      return { ok: true, output: "" };
    };
    let createdTag: { tag: string; commit: string } | undefined;

    const result = finishRelease(
      {
        headCommit: () => head,
        pushBranch,
        pushTag,
        createTag: (tag, commit) => {
          calls.push("createTag");
          createdTag = { tag, commit };
          return { ok: true, output: "" };
        }
      },
      { tag: "v0.5.4", branch: "main" }
    );

    expect(result).toEqual({ ok: true });
    expect(createdTag).toEqual({ tag: "v0.5.4", commit: "c24a8ba" });
    // The branch push must land before the tag is created, and the tag before its own push - the
    // workflow triggers on the tag arriving and checks out the commit it names.
    expect(calls).toEqual(["pushBranch", "createTag", "pushTag"]);
  });

  it("reports advice for nothing pushed, without retrying, when the branch push fails", () => {
    let pushBranchCalls = 0;
    let createTagCalls = 0;
    const rejected = "! [rejected]        main -> main (fetch first)";

    const result = finishRelease(
      {
        headCommit: () => "c24a8ba",
        pushBranch: () => {
          pushBranchCalls += 1;
          return { ok: false, output: rejected };
        },
        pushTag: () => ({ ok: true, output: "" }),
        createTag: () => {
          createTagCalls += 1;
          return { ok: true, output: "" };
        }
      },
      { tag: "v0.5.4", branch: "main" }
    );

    expect(pushBranchCalls).toBe(1);
    expect(createTagCalls).toBe(0);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.output).toBe(rejected);
    expect(!result.ok && result.advice).toEqual([
      "git push origin HEAD:main",
      "git tag v0.5.4 c24a8ba",
      "git push origin v0.5.4"
    ]);
  });

  it("reports advice for an unpushed tag when the tag push fails", () => {
    const result = finishRelease(
      {
        headCommit: () => "c24a8ba",
        pushBranch: () => ({ ok: true, output: "" }),
        pushTag: () => ({ ok: false, output: "! [rejected]" }),
        createTag: () => ({ ok: true, output: "" })
      },
      { tag: "v0.5.4", branch: "main" }
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.advice).toEqual(["git push origin v0.5.4"]);
  });

  it("reports advice for a created-but-unverified tag when creating the tag fails", () => {
    // `createTag` can fail too (a race, permissions), and swallowing that would exit the process
    // from inside `git()` with no FinishReleaseResult at all - the very "manual recovery" this
    // helper exists to produce. Reported like a push failure: no retry, since re-running `git tag`
    // against a tag that already exists is a different failure.
    const output = "git tag failed: fatal: tag 'v0.5.4' already exists";

    const result = finishRelease(
      {
        headCommit: () => "c24a8ba",
        pushBranch: () => ({ ok: true, output: "" }),
        pushTag: () => ({ ok: true, output: "" }),
        createTag: () => ({ ok: false, output })
      },
      { tag: "v0.5.4", branch: "main" }
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.output).toBe(output);
    expect(!result.ok && result.advice).toEqual([
      "git tag v0.5.4 c24a8ba",
      "git push origin v0.5.4"
    ]);
  });
});
