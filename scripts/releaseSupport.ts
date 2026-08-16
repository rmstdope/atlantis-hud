/**
 * What a failed git command should say.
 *
 * Both streams, because a hook talks on stderr and git talks on stdout, and the interesting half is
 * whichever one the reader was not expecting. `execFileSync` throws an error whose message is only
 * "Command failed", which is true and useless.
 */
export function describeGitFailure(args: string[], error: unknown): string {
  const said = [textOf(error, "stdout"), textOf(error, "stderr"), messageOf(error)]
    .map((part) => part.trim())
    .filter((part) => part !== "");

  // A stream often repeats the message. Saying it once reads as an explanation; twice reads as a
  // dump, and the reader stops looking for the line that matters.
  const lines = [...new Set(said)];

  return [`git ${args.map(quoteIfNeeded).join(" ")} failed.`, ...lines].join("\n");
}

/**
 * An argument as somebody would have to type it.
 *
 * `git commit -m Release v0.5.2` is a different command from the one that failed, and a reader who
 * pastes it back finds that out the hard way.
 */
function quoteIfNeeded(argument: string): string {
  return /[\s"']/u.test(argument) ? `"${argument.replace(/"/gu, '\\"')}"` : argument;
}

function textOf(error: unknown, stream: "stdout" | "stderr"): string {
  const value = (error as Record<string, unknown> | null)?.[stream];

  return typeof value === "string" ? value : Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    // "Command failed" on its own says nothing the first line has not already said.
    return /^command failed/iu.test(error.message) ? "" : error.message;
  }

  return String(error);
}

/** What a release did and did not manage, enough to say what finishing it by hand takes. */
export type ReleaseState = {
  tag: string;
  branch: string;
  /**
   * The SHA of the `Release vX.Y.Z` commit, recorded before any push ran. `git tag <name>` with no
   * second argument tags HEAD, and HEAD can have moved on by the time a human pastes this if
   * anything else committed on top of it in the meantime - naming the commit here is what keeps a
   * pasted recovery from landing on the wrong commit (ah-9dg).
   */
  releaseCommit: string;
  versionCommitPushed: boolean;
  tagCreated: boolean;
  tagPushed: boolean;
};

/**
 * The exact commands a human needs to finish a release that could not finish itself, naming the
 * actual tag, branch and release commit so the lines can be pasted rather than adapted.
 */
export function recoveryAdvice(state: ReleaseState): string[] {
  const lines: string[] = [];

  if (!state.versionCommitPushed) {
    lines.push(`git push origin HEAD:${state.branch}`);
  }
  if (!state.tagCreated) {
    lines.push(`git tag ${state.tag} ${state.releaseCommit}`);
  }
  if (!state.tagPushed) {
    lines.push(`git push origin ${state.tag}`);
  }

  return lines;
}

/** The git effects `finishRelease` needs, injected so the ordering and anchoring are provable. */
export type ReleaseEffects = {
  /** The current HEAD SHA. Called once, before any push, to pin the commit the tag will name. */
  headCommit: () => string;
  pushBranch: () => { ok: boolean; output: string };
  pushTag: () => { ok: boolean; output: string };
  createTag: (tag: string, commit: string) => { ok: boolean; output: string };
};

export type FinishReleaseResult = { ok: true } | { ok: false; output: string; advice: string[] };

/**
 * The release tail: push the version commit once, tag the commit it was made at, push the tag once.
 *
 * The SHA is read once, before `pushBranch` runs, so `createTag` always receives the commit recorded
 * here rather than a fresh read of HEAD - see `ReleaseState.releaseCommit` for why that matters.
 * There is no retry any more: with the bead export refreshed and committed before the bump (ah-cgk),
 * nothing else pushes main between here and the release's own push, so a push failure here is a
 * genuine refusal - a rejected ref, a credential failure - not something worth looping on.
 */
export function finishRelease(
  effects: ReleaseEffects,
  release: { tag: string; branch: string }
): FinishReleaseResult {
  const releaseCommit = effects.headCommit();

  const branchPush = effects.pushBranch();
  if (!branchPush.ok) {
    return {
      ok: false,
      output: branchPush.output,
      advice: recoveryAdvice({
        tag: release.tag,
        branch: release.branch,
        releaseCommit,
        versionCommitPushed: false,
        tagCreated: false,
        tagPushed: false
      })
    };
  }

  // Not retried: `createTag` failing once means the tag was not made, so a second `git tag` attempt
  // would meet a fresh state - unlike a push, where a retry used to mean meeting the export gate's
  // own abort.
  const created = effects.createTag(release.tag, releaseCommit);
  if (!created.ok) {
    return {
      ok: false,
      output: created.output,
      advice: recoveryAdvice({
        tag: release.tag,
        branch: release.branch,
        releaseCommit,
        versionCommitPushed: true,
        tagCreated: false,
        tagPushed: false
      })
    };
  }

  const tagPush = effects.pushTag();
  if (!tagPush.ok) {
    return {
      ok: false,
      output: tagPush.output,
      advice: recoveryAdvice({
        tag: release.tag,
        branch: release.branch,
        releaseCommit,
        versionCommitPushed: true,
        tagCreated: true,
        tagPushed: false
      })
    };
  }

  return { ok: true };
}
