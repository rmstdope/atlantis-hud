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
 * cerebro's `project-conf` script — that script lives in the submodule, which is empty in a
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
 * Mirrors cerebro's `project-conf` script's own format: `key value`, the value running to
 * the end of the line, and everything from a `#` on stripped first, at any column.
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

describe("the verification skill's wasm core check", () => {
  it("the skill has the verifier confirm the wasm core is current before the look begins", () => {
    const skillMd = readFileSync(
      join(REPO, ".claude", "skills", "atlantis-verification", "SKILL.md"),
      "utf8"
    );
    const heading = skillMd.indexOf("## The core the shell serves is checked, not assumed");
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(skillMd).toContain("node scripts/ensure-wasm.mjs");
    expect(heading).toBeLessThan(skillMd.indexOf("## Batch beads into one look"));
  });
});

describe("the verification skill's probe", () => {
  it("starts from the report's orders template and replaces only the unit a step edits (ah-uyq0l)", () => {
    const skillMd = readFileSync(
      join(REPO, ".claude", "skills", "atlantis-verification", "SKILL.md"),
      "utf8"
    );
    const section = skillMd.indexOf("## The fixture: pick one, prove it, or build a minimal one");
    const rule = skillMd.indexOf(
      "**An expected figure comes from the orders the app holds, not from the bead's orders alone.**"
    );
    const batch = skillMd.indexOf("**For a batch, scan rather than pick.**");
    expect(section).toBeGreaterThanOrEqual(0);
    expect(rule, "the skill has no rule that the probe starts from the orders template").toBeGreaterThan(section);
    expect(rule).toBeLessThan(batch);
    const ruleText = skillMd.slice(rule, batch);
    expect(ruleText).toContain("extract_orders_template");
    expect(ruleText).toContain("fn orders_as_the_app_holds_them");
    expect(ruleText).toContain("seedOrdersDocument");
    expect(ruleText.replace(/\s+/g, " ")).toContain(
      "with only the units a step edits replaced by what their orders box holds after it"
    );
  });
});

describe("the verification skill has Psylocke look herself (ah-jq6m8)", () => {
  const skillMd = () =>
    readFileSync(join(REPO, ".claude", "skills", "atlantis-verification", "SKILL.md"), "utf8");
  const flat = () => skillMd().replace(/\s+/g, " ");

  it("extends verify-bead rather than replacing it", () => {
    expect(flat()).toContain("This skill **extends `verify-bead`; it does not replace it.**");
  });

  it("carries the sections the navigator chose", () => {
    for (const heading of [
      "## Batch beads into one look",
      "## Protect the navigator's data",
      "## Which shell, and what is handed to the navigator",
      "## Human checks: one hand-off per batch",
      "## Explore near the change",
      "## Present the results",
      "## When the look is over"
    ]) {
      expect(skillMd(), `missing ${heading}`).toContain(heading);
    }
  });

  it("batches at most four beads at one main sha", () => {
    expect(flat()).toContain("**At most four beads per batch.**");
    expect(flat()).toContain("same `origin/main` sha");
  });

  it("snapshots and restores storage with the committed script", () => {
    const text = flat();
    expect(text).toContain("scripts/verify-storage.js");
    expect(text).toContain("atlantisVerifyStorage.snapshot()");
    expect(text).toContain("atlantisVerifyStorage.restore()");
    expect(text, "both calls run on a page of the origin with no app in it").toContain("/favicon.ico");
  });

  it("bounds exploration to about 10-15 minutes per batch", () => {
    expect(flat()).toContain("about 10–15 minutes per batch");
  });

  it("no longer writes a script for the navigator to run by hand", () => {
    expect(skillMd()).not.toContain("## The script the navigator reads");
    expect(skillMd()).not.toContain("## The handoff");
  });
});
