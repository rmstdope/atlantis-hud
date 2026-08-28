import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { findByTestId, queryByTestId } from "../testing/elementTree";
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

  it("the attitude follows the chip, with no spacer between them", () => {
    // The bug this bead fixes was a spacer stranding the attitude at the far right, away from the
    // name it belongs with.
    const markup = draw(thane, "hostile");

    expect(markup).not.toContain("ml-auto");
    expect(markup).toContain("flex-none");
  });

  it("a declared attitude is introduced by a lead-in", () => {
    // W2: beside the name, a bare `hostile` is a word without a subject.
    const markup = draw(thane, "hostile");

    expect(markup).toContain('data-testid="foreign-attitude-lead"');
    expect(markup).toContain("you have declared");
    expect(markup).toContain("hostile");
  });

  it("nothing declared stands alone, with no lead-in", () => {
    // W5a: `you have declared not declared` does not read, so the lead-in is dropped in that case.
    const markup = draw(thane, null);

    expect(markup).toContain("not declared");
    expect(markup).not.toContain("you have declared");
  });

  it("the lead-in is hidden until the strip has room for it", () => {
    // W6a: the lead-in carries no information, so it is the right thing to spend first when the
    // strip is narrow. A container query keeps the whole rule in CSS - this package has no jsdom,
    // so the visible behaviour is the smoke test's, and the classes are what can be asserted here.
    const strip = findByTestId(
      <ForeignStrip pin={thane} attitude="hostile" onClear={() => {}} />,
      "foreign-strip",
    );
    const lead = findByTestId(strip.props.children, "foreign-attitude-lead");

    expect(String(strip.props.className)).toContain("@container");
    expect(String(lead.props.className)).toContain("hidden");
    expect(String(lead.props.className)).toContain("@sm:block");
  });

  it("a concealed owner truncates the sentence and never the chip", () => {
    // W7a: `Faction not shown` is short and fixed, and the chip is the only way out of the pin, so
    // the sentence is what gives way - keeping its full text where the reader can reach it.
    const strip = findByTestId(
      <ForeignStrip
        pin={{ kind: "hidden" }}
        attitude="unfriendly"
        onClear={() => {}}
      />,
      "foreign-strip",
    );
    const chip = findByTestId(strip.props.children, "foreign-chip");
    const sentence = findByTestId(strip.props.children, "foreign-concealed");

    expect(String(chip.props.className)).toContain("flex-none");
    expect(String(sentence.props.className)).toContain("truncate");
    expect(sentence.props.title).toBe(
      "Their owner is concealed from you this turn.",
    );
  });

  it("the name and the way out are one chip", () => {
    // The claim is structural - "inside the chip", not "somewhere on the strip" - so it is made
    // against the element tree, which a string search of the markup could not distinguish.
    const chip = findByTestId(
      <ForeignStrip pin={thane} attitude="hostile" onClear={() => {}} />,
      "foreign-chip",
    );

    expect(
      queryByTestId(chip.props.children, "foreign-chip-name"),
    ).not.toBeNull();
    expect(queryByTestId(chip.props.children, "foreign-unpin")).not.toBeNull();
  });
});
