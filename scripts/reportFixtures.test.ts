import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { duplicateKey, fixtureFiles, parseFixtureName, passwordValue } from "./reportFixtures";

/**
 * Two invariants over the committed report fixtures, the way `cargoTargetDir.test.ts` tests the
 * repository's own `.cargo/config.toml`: the naming rule that keeps a same-numbered faction from two
 * different games apart, and the one that matters most - that no fixture carries a real password.
 *
 * See `tests/fixtures/reports/README.md` for where these come from and what each is good for.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "..", "tests", "fixtures", "reports");
const README = join(FIXTURES_DIR, "README.md");

describe("the report fixtures directory", () => {
  const files = fixtureFiles(FIXTURES_DIR);

  it("is not empty, or every other check here passes vacuously", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("every fixture names its ruleset, game, faction and turn", () => {
    const unnamed = files.filter((file) => parseFixtureName(file) === null);
    expect(unnamed).toEqual([]);
  });

  it("no fixture carries a password", () => {
    // Only the filename ever reaches the failure message - never the line, and never the value.
    const leaking = files.filter((file) => {
      const password = passwordValue(readFileSync(join(FIXTURES_DIR, file), "utf8"));
      return password !== null && password !== "<password>";
    });
    expect(leaking).toEqual([]);
  });

  it("every fixture is listed in the README", () => {
    const readme = readFileSync(README, "utf8");
    const missing = files.filter((file) => !readme.includes(file));
    expect(missing).toEqual([]);
  });

  it("no fixture is a duplicate of another game, faction and turn", () => {
    const seenBy = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of files) {
      const parsed = parseFixtureName(file);
      if (!parsed) {
        continue;
      }
      const key = duplicateKey(parsed);
      const seenAs = seenBy.get(key);
      if (seenAs) {
        duplicates.push(`${file} duplicates ${seenAs}`);
      } else {
        seenBy.set(key, file);
      }
    }
    expect(duplicates).toEqual([]);
  });
});
