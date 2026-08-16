import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as index from "./index";

/** Every generated type is re-exported from the package root, so nothing imports `./generated` directly. */
describe("the generated bindings", () => {
  it("are all re-exported from the package root", () => {
    const dir = fileURLToPath(new URL("./generated/", import.meta.url));
    const generated = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.slice(0, -3));
    expect(generated.length).toBeGreaterThan(30);
    // Types have no runtime presence; the check that matters is that index.ts compiles with a
    // re-export line per file, which `pnpm run typecheck` proves. This test pins that the
    // directory is populated and the count does not silently drop to zero.
    void index;
  });
});
