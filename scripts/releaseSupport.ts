import { PUSH_AGAIN_MESSAGE } from "./beadsExportGate";

/**
 * The two things that stranded v0.5.2, kept apart from the script that does them.
 *
 * `pnpm run release` committed the version bump and then died at the push, leaving both manifests
 * at the new version with no tag and nothing on the remote. Re-running made it worse: the tree was
 * clean at the already-bumped version, so the next run bumped again and the stranded version was
 * never released.
 *
 * The push failed because the bead export gate aborts the first push on main when the committed
 * export is stale. That is deliberate - a pre-push hook cannot amend the refs git has already
 * computed, so it commits the refresh and asks for another push - and the release script simply did
 * not know. Worse, its git helper piped both streams, so the gate's explanation went into a buffer
 * nobody read and the release looked like an unexplained crash.
 *
 * Cutting a release follows bead work, so the export is stale on essentially every release. v0.5.1
 * got through only because it happened to be current.
 */

/**
 * What to do after running the export gate, before anything is at stake.
 *
 * The gate answers non-zero when it has committed a refresh and stopped a push. That commit is
 * local, so it has to reach the remote before the release commit is built on top of it - and once
 * it has, the gate is a no-op for the rest of the run and the release's own push meets nothing.
 */
export function settleStep(gateCode: number): "push" | "none" {
  return gateCode === 0 ? "none" : "push";
}

/** What settling the export produced: something to do, or a reason it could not be done. */
export type Settlement = { action: "push" | "none" } | { problem: string };

/**
 * Runs the gate and says what follows, without letting it take the release down.
 *
 * The gate guards itself only on its command-line path; called as a function it can throw - a
 * missing database, a git that will not commit, anything unforeseen. An uncaught throw here would
 * be the very failure this bead exists to remove, and the only reason it would be less damaging is
 * that it lands before the bump rather than after it. That is luck, not design.
 *
 * A problem is reported rather than swallowed. A stale export that cannot be settled means the push
 * after the bump would abort anyway, so stopping now - with nothing written - is the kind outcome.
 */
export function settleExport(gate: () => number): Settlement {
  try {
    return { action: settleStep(gate()) };
  } catch (error) {
    const because = error instanceof Error ? error.message : String(error);

    return { problem: `the bead export gate could not run: ${because}` };
  }
}

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

/**
 * The retry v0.5.3 was missing.
 *
 * `settleExport` narrows the window between the export going stale and the release's own push, but
 * does not close it: the gate runs again on that push, minutes later, and with other agents claiming
 * and heartbeating beads the export can have gone stale again by then. v0.5.3 ended with the version
 * committed, nothing pushed and no tag - recovered by hand with one retried `git push`.
 *
 * Whether a failed push is the gate asking for another push, rather than a genuine refusal - a
 * rejected ref, a credential failure - which must never be retried into a loop.
 */
export function isGateAbort(output: string): boolean {
  return output.includes(PUSH_AGAIN_MESSAGE);
}

export type PushResult = { ok: true } | { ok: false; output: string };

/**
 * Retries a push while, and only while, it fails on the gate's own abort.
 *
 * The push is injected so this is testable without git or a remote. Bounded, because the export can
 * go stale again between two attempts and an unbounded loop against a genuinely refusing remote is
 * worse than a clear failure - the manual recoveries this bead is named for both needed exactly one
 * retry.
 */
export function pushWithRetry(
  push: () => { ok: boolean; output: string },
  attempts: number
): PushResult {
  let last: { ok: boolean; output: string } = { ok: false, output: "" };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = push();
    if (last.ok) {
      return { ok: true };
    }
    if (!isGateAbort(last.output)) {
      return { ok: false, output: last.output };
    }
  }

  return {
    ok: false,
    output: `the export gate kept refreshing after ${attempts} attempts:\n${last.output}`
  };
}

/** What a release did and did not manage, enough to say what finishing it by hand takes. */
export type ReleaseState = {
  tag: string;
  branch: string;
  /**
   * The SHA of the `Release vX.Y.Z` commit, recorded before any push ran. `git tag <name>` with no
   * second argument tags HEAD, and HEAD can have moved on by the time a human pastes this - the
   * export gate commits a refresh on top of it during a push. Naming the commit here is what keeps
   * a pasted recovery from reproducing the exact bug this bead exists to fix.
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
 * The release tail: push the version commit, tag the commit it was made at, push the tag.
 *
 * The SHA is read once, before `pushBranch` runs, because the export gate can commit a refresh on
 * top of HEAD while settling a push - so HEAD by the time `createTag` would run is not necessarily
 * the release commit any more. `createTag` always receives the SHA recorded here, never a fresh
 * read of HEAD.
 */
export function finishRelease(
  effects: ReleaseEffects,
  release: { tag: string; branch: string; attempts: number }
): FinishReleaseResult {
  const releaseCommit = effects.headCommit();

  const branchPush = pushWithRetry(effects.pushBranch, release.attempts);
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
  // would meet a fresh state - unlike a push, where a retry is meeting the export gate's own abort.
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

  const tagPush = pushWithRetry(effects.pushTag, release.attempts);
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
