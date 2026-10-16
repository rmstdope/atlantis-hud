import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ItemsHiddenLine, Marked, MarkedItemPart } from "./UnitFilterMarks";

describe("Marked (ah-ykac)", () => {
  it("marks every occurrence of what was typed, keeping the text's own case", () => {
    const markup = renderToStaticMarkup(<Marked text="Olive Live" needle="live" />);

    expect(markup.match(/<mark[^>]*>live<\/mark>/g)).toHaveLength(1);
    expect(markup.match(/<mark[^>]*>Live<\/mark>/g)).toHaveLength(1);
    expect(markup.replace(/<[^>]+>/g, "")).toBe("Olive Live");
  });

  it("draws plain text when the box is empty", () => {
    expect(renderToStaticMarkup(<Marked text="Farmers" needle="" />)).toBe("Farmers");
  });
});

describe("MarkedItemPart (ah-ykac)", () => {
  const part = { text: "40 LIVE", unfinished: false, tag: "LIVE", name: "livestock" };

  it("marks within the code on a code match, never the amount", () => {
    const markup = renderToStaticMarkup(<MarkedItemPart part={{ ...part, match: "text" }} needle="iv" />);

    expect(markup).toMatch(/^40 L<mark[^>]*>IV<\/mark>E$/);
  });

  it("marks the whole code when only the name matched", () => {
    const markup = renderToStaticMarkup(
      <MarkedItemPart part={{ ...part, match: "name" }} needle="livestock" />
    );

    expect(markup).toMatch(/^40 <mark[^>]*>LIVE<\/mark>$/);
  });

  it("marks nothing in an item that did not match", () => {
    expect(renderToStaticMarkup(<MarkedItemPart part={{ ...part, match: null }} needle="4" />)).toBe(
      "40 LIVE"
    );
  });
});

describe("ItemsHiddenLine (ah-ykac)", () => {
  it("says the agreed sentence, and offers Show it as a button", () => {
    const markup = renderToStaticMarkup(<ItemsHiddenLine onShow={() => {}} />);

    expect(markup.replace(/<[^>]+>/g, "")).toBe(
      "Some units are listed for what they carry — the Items column is hidden. Show it"
    );
    expect(markup).toMatch(/<button type="button"[^>]*>Show it<\/button>/);
  });
});
