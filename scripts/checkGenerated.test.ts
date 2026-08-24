import { describe, expect, it } from "vitest";
import { GENERATED_DIRS, staleFiles } from "./checkGenerated";

describe("staleFiles", () => {
  it("names each path git reports as changed or new under the generated directory", () => {
    const porcelain =
      " M packages/core-client/src/generated/Battle.ts\n?? packages/core-client/src/generated/New.ts\n";

    expect(staleFiles(porcelain)).toEqual([
      "packages/core-client/src/generated/Battle.ts",
      "packages/core-client/src/generated/New.ts"
    ]);
  });

  it("names nothing when git reports a clean tree", () => {
    expect(staleFiles("")).toEqual([]);
  });
});

describe("GENERATED_DIRS", () => {
  it("covers both generated directories, so the ruleset schema is checked too", () => {
    expect(GENERATED_DIRS).toEqual([
      "packages/core-client/src/generated",
      "packages/ruleset/src/generated"
    ]);
  });
});
