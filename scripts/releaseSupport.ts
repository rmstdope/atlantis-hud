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

  return [`git ${args.join(" ")} failed.`, ...lines].join("\n");
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
