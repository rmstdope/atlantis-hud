import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ForeignStrip } from "./ForeignStrip";
import type { FactionPin } from "./unitSource";

const thane: FactionPin = { kind: "faction", factionId: "10", factionName: "Thane's Ring" };

const draw = (pin: FactionPin, attitude: string | null) =>
  renderToStaticMarkup(<ForeignStrip pin={pin} attitude={attitude} onClear={() => {}} />);

describe("what the Other factions list is narrowed to", () => {
  it("the strip names the faction and its attitude", () => {
    const markup = draw(thane, "unfriendly");

    expect(markup).toContain('data-testid="foreign-strip"');
    expect(markup).toContain("Thane&#x27;s Ring (10)");
    expect(markup).toContain("unfriendly");
  });

  it("offers a way to stop showing only that faction", () => {
    const markup = draw(thane, "hostile");

    expect(markup).toContain('data-testid="foreign-unpin"');
    expect(markup).toContain('aria-label="stop showing only this faction"');
  });

  it("carries the untruncated label in a title, since the chip is what truncates", () => {
    // W3: the name truncates and the attitude never does, so the full name has to survive
    // somewhere the reader can reach it.
    const markup = draw(thane, "ally");

    expect(markup).toMatch(/title="Thane&#x27;s Ring \(10\)"/u);
    expect(markup).toContain("truncate");
    expect(markup).toContain("flex-none");
  });

  it("a hidden pin says the owner is concealed instead of an attitude", () => {
    // There is no faction here to have an attitude toward - `rules/stealthobs`: equal Observation
    // shows the unit but not the name of the owning faction.
    const markup = draw({ kind: "hidden" }, "unfriendly");

    expect(markup).toContain("Faction not shown");
    expect(markup).toContain("Their owner is concealed from you this turn.");
    expect(markup).not.toContain("unfriendly");
  });

  it("not declared stands in for a faction with no declared attitude", () => {
    expect(draw(thane, null)).toContain("not declared");
  });
});
