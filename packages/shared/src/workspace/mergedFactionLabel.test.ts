import { describe, expect, it } from "vitest";
import { mergedFactionLabel } from "./mergedFactionLabel";

describe("how a merged-reports row names its source", () => {
  it("names an ally's faction and its number", () => {
    expect(mergedFactionLabel({ mergedFactionId: "73", mergedFactionName: "Borg" })).toBe(
      "Borg (73)"
    );
  });

  it("names an AtlaClient map alone, because the reserved id means nothing to the player", () => {
    expect(
      mergedFactionLabel({
        mergedFactionId: "atlaclient",
        mergedFactionName: "AtlaClient, turn 16"
      })
    ).toBe("AtlaClient, turn 16");
  });
});
