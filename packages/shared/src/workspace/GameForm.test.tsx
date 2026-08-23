import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameForm, gameSubmission } from "./GameForm";

describe("creating a game whose map cannot wrap", () => {
  it("does not create a game whose map cannot wrap", () => {
    // A disabled button is not a guarantee - Enter in a text field submits a form - so the submit
    // path re-asks the same question, and this is that question.
    expect(
      gameSubmission("Hexes", "neworigins", { width: "71", height: "96", wrapX: true, wrapY: false })
    ).toBeNull();
    expect(
      gameSubmission("Hexes", "neworigins", { width: "72", height: "95", wrapX: false, wrapY: true })
    ).toBeNull();
  });

  it("creates the game the player stated when the map is drawable", () => {
    expect(
      gameSubmission("Hexes", "neworigins", { width: "72", height: "96", wrapX: true, wrapY: false })
    ).toEqual({
      name: "Hexes",
      rulesetId: "neworigins",
      map: { width: 72, height: 96, wrapX: true, wrapY: false }
    });
  });

  it("still creates a game whose map fields were cleared", () => {
    // Today's deliberate behaviour: no map is stated, and no parity message is owed about one.
    expect(
      gameSubmission("Hexes", "neworigins", { width: "", height: "", wrapX: true, wrapY: true })
    ).toEqual({ name: "Hexes", rulesetId: "neworigins", map: undefined });
  });

  it("offers a working form for the ruleset's own map", () => {
    const markup = renderToStaticMarkup(<GameForm busy={false} error={null} onCreate={() => {}} />);

    expect(markup).not.toContain("game-map-problem");
    // `disabled=""` is the attribute; `disabled:opacity-50` is a class name, so match the tag.
    expect(markup).toMatch(/<button type="submit"[^>]*>/u);
    expect(markup.match(/<button type="submit"[^>]*>/u)?.[0]).not.toContain('disabled=""');
  });
});
