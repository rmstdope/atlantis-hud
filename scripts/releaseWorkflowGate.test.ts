import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_BUNDLE_JOBS,
  hasWebTarballJob,
  LAUNCH_CHECK_STEP,
  launchChecksBeforeUpload,
  publishAttachesWebTarball,
  publishNeedsWebTarball,
  publishingJobsWithoutTagGuard,
  runsOnPullRequestsTouching,
  tagOnlyStepsMissingGuard,
  WEB_TARBALL_GLOB,
  WEB_TARBALL_JOB
} from "./releaseWorkflowGate";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOW = readFileSync(join(REPO, ".github", "workflows", "release.yml"), "utf8");

describe("the release workflow attaches the self-hosting tarball", () => {
  it(`declares a "${WEB_TARBALL_JOB}" job`, () => {
    expect(hasWebTarballJob(WORKFLOW)).toBe(true);
  });

  it(`makes "publish" wait on "${WEB_TARBALL_JOB}"`, () => {
    expect(publishNeedsWebTarball(WORKFLOW)).toBe(true);
  });

  it(`attaches "${WEB_TARBALL_GLOB}" to the release`, () => {
    expect(publishAttachesWebTarball(WORKFLOW)).toBe(true);
  });
});

describe("the release workflow launches every desktop bundle before publishing it (R55)", () => {
  for (const job of DESKTOP_BUNDLE_JOBS) {
    it(`"${job}" installs and launches its bundle between building and uploading it`, () => {
      expect(launchChecksBeforeUpload(WORKFLOW, job)).toBe(true);
    });
  }

  it("a pull request run of the workflow publishes nothing", () => {
    expect(publishingJobsWithoutTagGuard(WORKFLOW)).toEqual([]);
  });

  it("a pull request run neither signs nor saves release build caches", () => {
    expect(tagOnlyStepsMissingGuard(WORKFLOW)).toEqual([]);
  });

  it("the workflow runs on a pull request that changes it or the launch check", () => {
    expect(runsOnPullRequestsTouching(WORKFLOW)).toEqual([
      ".github/workflows/release.yml",
      "scripts/desktopLaunchCheck.ts"
    ]);
  });
});

describe("the R55 launch-check reading of a workflow", () => {
  const job = (steps: string) => `jobs:\n  linux:\n    runs-on: x\n    steps:\n${steps}`;
  const build = "      - name: Build the Linux bundle\n        run: b\n";
  const check = `      - name: ${LAUNCH_CHECK_STEP}\n        run: c target/x/*.AppImage\n`;
  const upload = "      - name: Upload the Linux bundle\n        with:\n          path: target/x/*.AppImage\n";

  it("accepts the check between build and upload", () => {
    expect(launchChecksBeforeUpload(job(build + check + upload), "linux")).toBe(true);
  });

  it("refuses a missing check, or one after the upload", () => {
    expect(launchChecksBeforeUpload(job(build + upload), "linux")).toBe(false);
    expect(launchChecksBeforeUpload(job(build + upload + check), "linux")).toBe(false);
  });

  it("refuses a check that launches something other than what is uploaded", () => {
    const other = `      - name: ${LAUNCH_CHECK_STEP}\n        run: c target/y/*.AppImage\n`;
    expect(launchChecksBeforeUpload(job(build + other + upload), "linux")).toBe(false);
  });
});
