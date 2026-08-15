import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  hasWebTarballJob,
  publishAttachesWebTarball,
  publishNeedsWebTarball,
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
