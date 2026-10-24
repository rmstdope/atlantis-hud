/**
 * Keeps the release workflow honest about the self-hosting tarball, at the one moment it matters.
 *
 * `release.yml`'s `publish` job is the single place that attaches things to a GitHub release
 * (`ah-4sh`'s plan). A later edit to that job - reordering the `needs:` list, trimming a `files:`
 * glob during a tidy-up - could silently drop the web tarball from the release without any test
 * noticing, since nothing else in the repository reads this workflow. These assertions read the
 * workflow as text, the same way `ciDocsGate.ts` reads `ci.yml`, and fail the moment either
 * invariant breaks.
 */

import { jobBlocks } from "./ciDocsGate";

/** The job that builds and uploads the self-hosting tarball. */
export const WEB_TARBALL_JOB = "web-tarball";

/** The job that attaches every release artifact, including the tarball. */
export const PUBLISH_JOB = "publish";

/** The glob the tarball must be published under, downloaded from `WEB_TARBALL_JOB`'s upload. */
export const WEB_TARBALL_GLOB = "release-artifacts/web/*.tar.gz";

/** Whether the workflow declares a job that builds the web self-hosting tarball. */
export function hasWebTarballJob(yaml: string): boolean {
  return jobBlocks(yaml).has(WEB_TARBALL_JOB);
}

/** Whether `publish`'s `needs:` list includes the tarball job, so publishing waits on it. */
export function publishNeedsWebTarball(yaml: string): boolean {
  const publish = jobBlocks(yaml).get(PUBLISH_JOB);
  if (publish === undefined) {
    return false;
  }
  const needsLine = publish.match(/^ {4}needs:.*$/mu);
  return needsLine !== null && new RegExp(`\\b${WEB_TARBALL_JOB}\\b`, "u").test(needsLine[0]);
}

/** Whether `publish`'s `files:` list carries the tarball's glob, so the release attaches it. */
export function publishAttachesWebTarball(yaml: string): boolean {
  const publish = jobBlocks(yaml).get(PUBLISH_JOB);
  if (publish === undefined) {
    return false;
  }
  return publish.includes(WEB_TARBALL_GLOB);
}

/** The jobs that build, and so must launch, a desktop bundle a release publishes (R55). */
export const DESKTOP_BUNDLE_JOBS = ["macos", "linux", "windows"] as const;

/** The step in each of them that installs and launches the bundle; R55's Proven by line names it. */
export const LAUNCH_CHECK_STEP = "Launch the built bundle and check its window opens (R55)";

/** The jobs that publish or deploy something, which a pull-request run must skip. */
export const PUBLISHING_JOBS = ["web-tarball", "web-image", "publish", "publish-deployment", "web"] as const;

/** The guard that keeps a job to a tag push. */
export const TAG_GUARD = "if: github.ref_type == 'tag'";

/** Step names in a job, in order. */
function stepNames(job: string): string[] {
  return [...job.matchAll(/^ {6}- name: (.+)$/gmu)].map((match) => match[1].trim());
}

/**
 * Whether `job` launches its bundle after building it and before uploading it - so the file the
 * release attaches is the file that was seen to start.
 */
export function launchChecksBeforeUpload(yaml: string, job: string): boolean {
  const block = jobBlocks(yaml).get(job);
  if (block === undefined) {
    return false;
  }
  const names = stepNames(block);
  const check = names.indexOf(LAUNCH_CHECK_STEP);
  const build = names.findIndex((name) => name.startsWith("Build the "));
  const upload = names.findIndex((name) => name.startsWith("Upload the "));
  return build !== -1 && upload !== -1 && build < check && check < upload;
}

/** The publishing jobs not guarded to a tag push at job level, so a pull-request run would run them. */
export function publishingJobsWithoutTagGuard(yaml: string): string[] {
  const blocks = jobBlocks(yaml);
  return PUBLISHING_JOBS.filter((job) => !(blocks.get(job) ?? "").split("\n").some((line) => line === `    ${TAG_GUARD}`));
}

/** The `paths:` a `pull_request` trigger lists, or `[]` when the workflow has none. */
export function runsOnPullRequestsTouching(yaml: string): string[] {
  const on = yaml.match(/^on:\n((?: .*\n|\n)*)/mu)?.[1] ?? "";
  const pullRequest = on.match(/^ {2}pull_request:\n((?: {4}.*\n)*)/mu)?.[1] ?? "";
  return [...pullRequest.matchAll(/^ {6}- "?([^"\n]+)"?$/gmu)].map((match) => match[1]);
}
