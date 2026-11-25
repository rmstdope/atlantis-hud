import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WORKFLOWS = join(ROOT, ".github", "workflows");
const COMPOSITE_ACTIONS = join(ROOT, ".github", "actions");

const EXPECTED_MAJORS = {
  "actions/checkout": 7,
  "actions/cache": 6,
  "actions/setup-node": 7,
  "actions/upload-artifact": 7,
  "actions/download-artifact": 8,
  "pnpm/action-setup": 6
} as const;

const isYaml = (file: string) => file.endsWith(".yml") || file.endsWith(".yaml");

// Workflows, and every composite action under .github/actions/ — a Dependabot bump inside a
// composite action is a pin like any other (ah-162ne).
function pinnedFiles(): string[] {
  const workflows = readdirSync(WORKFLOWS)
    .filter(isYaml)
    .map((file) => join(WORKFLOWS, file));
  const composites = readdirSync(COMPOSITE_ACTIONS, { recursive: true, encoding: "utf8" })
    .filter((file) => /(^|[\\/])action\.ya?ml$/.test(file))
    .map((file) => join(COMPOSITE_ACTIONS, file));
  return [...workflows, ...composites];
}

function workflowActionPins(): { action: string; major: number; file: string }[] {
  return pinnedFiles()
    .map((path) => relative(ROOT, path))
    .flatMap((file) => {
      const text = readFileSync(join(ROOT, file), "utf8");
      return [...text.matchAll(/uses:\s*([^\s@]+)@v(\d+)/g)]
        .filter((match) => match[1] in EXPECTED_MAJORS)
        .map((match) => ({ action: match[1], major: Number(match[2]), file }));
    });
}

describe("GitHub Actions workflow pins", () => {
  it("pins every JavaScript action in workflows and composite actions to its chosen Node 24 major", () => {
    const pins = workflowActionPins();
    const expectedActions = Object.keys(EXPECTED_MAJORS).sort();
    const foundActions = [...new Set(pins.map(({ action }) => action))].sort();
    const mismatches = pins
      .filter((pin) => pin.major !== EXPECTED_MAJORS[pin.action as keyof typeof EXPECTED_MAJORS])
      .map(
        (pin) =>
          `${pin.file}: ${pin.action}@v${pin.major}; expected ${pin.action}@v${EXPECTED_MAJORS[pin.action as keyof typeof EXPECTED_MAJORS]}`
      );

    expect(foundActions).toEqual(expectedActions);
    expect(mismatches).toEqual([]);
  });
});
