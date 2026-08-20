/**
 * The container tag and the installed Playwright must be the same version.
 *
 * `package.json` declares a caret range (`^1.55.0`) and the lockfile resolves something quite
 * different (1.62.1 when this was written) - so the tag cannot be derived from the manifest, and a
 * `pnpm update` that moves the lockfile would otherwise leave CI running a browser the client
 * cannot drive. The failure that produces is "executable doesn't exist", in CI, on a change that
 * looks unrelated - which is exactly the shape ah-f9q9 was filed to stop (ah-3c80's four stalls).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOWS = join(REPO, ".github", "workflows");

/** The version `pnpm-lock.yaml` actually resolves for the `playwright` package. */
function lockfileVersion(): string {
  const lock = readFileSync(join(REPO, "pnpm-lock.yaml"), "utf8");
  const versions = new Set(
    [...lock.matchAll(/^ {2}playwright@(\d+\.\d+\.\d+):/gm)].map((match) => match[1])
  );
  expect([...versions]).toHaveLength(1);
  return [...versions][0];
}

/** Every `mcr.microsoft.com/playwright:v<version>` tag named anywhere under `.github/workflows/`. */
function imageTags(): { file: string; version: string; tag: string }[] {
  return readdirSync(WORKFLOWS)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .flatMap((file) => {
      const text = readFileSync(join(WORKFLOWS, file), "utf8");
      return [...text.matchAll(/mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)(\S*)/g)].map(
        (match) => ({ file, version: match[1], tag: `v${match[1]}${match[2]}` })
      );
    });
}

describe("the Playwright container tracks the lockfile", () => {
  // Without this the regexes above could stop matching - a renamed image, a moved workflow - and
  // the coupling test would pass forever while checking nothing.
  it("there is at least one image tag to check", () => {
    expect(imageTags().length).toBeGreaterThan(0);
  });

  it("every workflow's Playwright image matches the lockfile", () => {
    const resolved = lockfileVersion();
    const drifted = imageTags().filter((found) => found.version !== resolved);
    expect(
      drifted.map((found) => `${found.file} pins ${found.tag}, but pnpm-lock.yaml resolves ${resolved}`)
    ).toEqual([]);
  });
});
