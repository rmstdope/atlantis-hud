import { describe, expect, it, vi } from "vitest";
import { OPEN_EXTERNAL_IN_NEW_TAB } from "./openExternal";

describe("OPEN_EXTERNAL_IN_NEW_TAB", () => {
  it("opens the url in a new tab that cannot reach back", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    OPEN_EXTERNAL_IN_NEW_TAB("https://example.test/page");

    expect(open).toHaveBeenCalledWith("https://example.test/page", "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });
});
