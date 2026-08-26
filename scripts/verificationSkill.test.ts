/**
 * `.cerebro/project.conf`'s `verification_skill` declaration and the skill directory it names must
 * never drift apart.
 *
 * Psylocke (the verifier role) reads `project-conf verification_skill` before it prepares a manual
 * verification, and loads whatever skill that names. A declaration that outlives its skill
 * directory — a rename on one side and not the other — means the key resolves to nothing loadable,
 * and Psylocke silently falls back to improvising the navigator's five minutes exactly the way this
 * whole mechanism (ah-38qc) exists to prevent. This is the same class of guard as the fixtures
 * lockstep test described in `tests/fixtures/reports/README.md`: catch the drift here, once, rather
 * than as a confusing "nothing was loaded" a role can't diagnose on its own.
 *
 * Parses `.cerebro/project.conf` directly rather than shelling out to
 * `.claude/cerebro/scripts/project-conf` — that script lives in the submodule, which is empty in a
 * clone made without `--recurse-submodules`, and a gate that fails on a missing submodule reports
 * the wrong thing.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The value declared for `key` in `.cerebro/project.conf`, or `undefined` if the key is absent.
 * Mirrors `scripts/project-conf`'s own format: `key value`, the value running to the end of the
 * line, and everything from a `#` on stripped first, at any column.
 */
function projectConfValue(key: string): string | undefined {
  const conf = readFileSync(join(REPO, ".cerebro", "project.conf"), "utf8");
  for (const rawLine of conf.split("\n")) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [foundKey, ...rest] = line.split(/\s+/);
    if (foundKey === key) return rest.join(" ");
  }
  return undefined;
}

describe("the project's declared verification skill", () => {
  it("the project declares a verification skill", () => {
    const value = projectConfValue("verification_skill");
    expect(
      value,
      "the declaration is missing — .cerebro/project.conf has no verification_skill line"
    ).toBeDefined();
    expect(
      value,
      `verification_skill's value must be a single token with no whitespace, got ${JSON.stringify(value)}`
    ).toMatch(/^\S+$/);
  });

  it("the declared verification skill is a real skill directory", () => {
    const value = projectConfValue("verification_skill")!;
    const skillDir = join(REPO, ".claude", "skills", value);
    expect(
      existsSync(join(skillDir, "SKILL.md")),
      `the declaration names a skill that is not there; rename one or the other (looked for ${skillDir}/SKILL.md)`
    ).toBe(true);
  });

  it("the skill's own name matches what the project declares", () => {
    const value = projectConfValue("verification_skill")!;
    const skillMd = readFileSync(join(REPO, ".claude", "skills", value, "SKILL.md"), "utf8");
    const nameMatch = skillMd.match(/^name:\s*(\S+)\s*$/m);
    expect(
      nameMatch,
      `${value}/SKILL.md has no frontmatter "name:" line`
    ).not.toBeNull();
    expect(
      nameMatch![1],
      `the declaration names "${value}" but the skill's own frontmatter says "${nameMatch?.[1]}"; rename one or the other`
    ).toBe(value);
  });
});
