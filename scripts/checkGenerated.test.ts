import { describe, expect, it } from "vitest";
import { staleFiles } from "./checkGenerated";

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
