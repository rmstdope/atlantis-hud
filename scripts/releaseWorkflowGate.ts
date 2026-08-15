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
