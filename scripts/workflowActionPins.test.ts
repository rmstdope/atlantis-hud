import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS = join(process.cwd(), ".github", "workflows");

const EXPECTED_MAJORS = {
  "actions/checkout": 5,
  "actions/cache": 5,
  "actions/setup-node": 6,
  "actions/upload-artifact": 6,
  "actions/download-artifact": 7,
  "pnpm/action-setup": 5
} as const;

function workflowActionPins(): { action: string; major: number; file: string }[] {
  return readdirSync(WORKFLOWS)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .flatMap((file) => {
      const text = readFileSync(join(WORKFLOWS, file), "utf8");
      return [...text.matchAll(/uses:\s*([^\s@]+)@v(\d+)/g)]
        .filter((match) => match[1] in EXPECTED_MAJORS)
        .map((match) => ({ action: match[1], major: Number(match[2]), file }));
    });
}

describe("GitHub Actions workflow pins", () => {
  it("pins every JavaScript workflow action to its chosen Node 24 major", () => {
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
