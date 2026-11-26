import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { jobBlocks } from "./ciDocsGate";

/**
 * atlantis-hud.kurelid.se stays frozen at v0.35.0 (ah-iufcs): no release after it publishes there,
 * and no build after it carries code that only that address could run.
 */

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const OLD_HOST = "atlantis-hud.kurelid.se";

function trackedFilesNaming(text: string, ...paths: string[]): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ...paths], { cwd: REPO, encoding: "utf8" })
    .split("\0")
    .filter((path) => path !== "" && existsSync(join(REPO, path)) && statSync(join(REPO, path)).isFile())
    .filter((path) => readFileSync(join(REPO, path), "utf8").includes(text));
}

describe("the old address is retired", () => {
  it("no workflow publishes to it", () => {
    expect(existsSync(join(REPO, ".github", "workflows", "deploy.yml"))).toBe(false);
    const release = readFileSync(join(REPO, ".github", "workflows", "release.yml"), "utf8");
    expect([...jobBlocks(release).values()].filter((job) => job.includes("deploy.yml"))).toEqual([]);
    expect(trackedFilesNaming(OLD_HOST, ".github")).toEqual([]);
  });

  it("the application carries no code for it", () => {
    expect(trackedFilesNaming(OLD_HOST, "apps", "packages", "tests")).toEqual([]);
  });
});
