import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_DIRS } from "./checkGenerated";
import {
  BINDINGS_STEP,
  bindingsStep,
  declaredDirs,
  RUST_JOB,
  statusPathspecs
} from "./generatedBindingsGate";

const yaml = readFileSync(fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)), "utf8");

describe("ci.yml generated-bindings step", () => {
  const step = bindingsStep(yaml);

  it("finds the bindings step in the rust job", () => {
    expect(step).not.toBeNull();
  });

  it("declares exactly the directories checkGenerated.ts checks", () => {
    if (step === null) {
      throw new Error(`could not find step "${BINDINGS_STEP}" in job "${RUST_JOB}"`);
    }
    expect(declaredDirs(step)).toEqual(GENERATED_DIRS);
  });

  it("checks nothing but the directories it declared", () => {
    if (step === null) {
      throw new Error(`could not find step "${BINDINGS_STEP}" in job "${RUST_JOB}"`);
    }
    expect(statusPathspecs(step)).toEqual(["$GENERATED"]);
  });
});

describe("bindingsStep", () => {
  it("returns null when the rust job has been renamed", () => {
    const renamed = yaml.replace(/^ {2}rust:\s*$/mu, "  rust-renamed:");
    expect(bindingsStep(renamed)).toBeNull();
  });

  it("returns null when the step has been renamed", () => {
    const renamed = yaml.replace(BINDINGS_STEP, "Something else entirely");
    expect(bindingsStep(renamed)).toBeNull();
  });
});

describe("declaredDirs", () => {
  it("names nothing when the step declares no list", () => {
    const step = `      - name: ${BINDINGS_STEP}\n        run: |\n          echo "no assignment here"\n`;
    expect(declaredDirs(step)).toEqual([]);
  });
});
