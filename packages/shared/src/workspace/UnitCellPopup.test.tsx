import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PopupLine } from "../unitCellPopup";
import { PopupCaveat, PopupLineLabel, PopupLineValue, PopupRow } from "./UnitCellPopup";

const draw = (line: PopupLine) => renderToStaticMarkup(<PopupLineValue line={line} />);

describe("PopupLineValue", () => {
  it("a figure that rose is drawn as the pair, the new figure in the up colour", () => {
    const markup = draw({ label: "men", value: "12", change: { direction: "up", from: "8" } });
    expect(markup).toMatch(/8[\s\S]*→[\s\S]*12/);
    expect(markup).toMatch(/text-ok[^>]*>12</);
  });

  it("a figure that fell puts the new figure in the down colour", () => {
    const markup = draw({ label: "horse", value: "2", change: { direction: "down", from: "3" } });
    expect(markup).toMatch(/3[\s\S]*→[\s\S]*2/);
    expect(markup).toMatch(/text-danger[^>]*>2</);
  });

  // `ah-44at`: what a refused cast would have made is struck through and dimmed, whole (Q3 B).
  it("a struck line is drawn through and dim, with no up or down colour", () => {
    const line: PopupLine = {
      label: "Cloudship CLOU",
      value: "0-1",
      change: { direction: "up", from: "none" },
      struck: true
    };
    const value = draw(line);
    expect(value).toMatch(/line-through[^"]*text-ink-dim|text-ink-dim[^"]*line-through/);
    expect(value).toMatch(/none[\s\S]*→[\s\S]*0-1/);
    expect(value).not.toContain("text-ok");
    const label = renderToStaticMarkup(<PopupLineLabel line={line} />);
    expect(label).toContain("line-through");
    expect(label).toContain("text-ink-dim");
  });

  it("a figure that did not move is drawn on its own", () => {
    const markup = draw({ label: "silver", value: "40" });
    expect(markup).not.toContain("→");
    expect(markup).not.toContain("text-ok");
    expect(markup).not.toContain("text-danger");
  });

  it("a chain is drawn in order, each arrow between two figures", () => {
    const markup = draw({
      label: "combat COMB",
      value: "1 (53)",
      steps: [
        { value: "2 (90)", mark: "reported" },
        { value: "1 (53)", mark: "down" },
        { value: "2 (98)", mark: "projected" }
      ]
    });
    expect(markup).toMatch(/2 \(90\)[\s\S]*→[\s\S]*1 \(53\)[\s\S]*→[\s\S]*2 \(98\)/);
  });

  it("the projected figure is drawn in the selection blue whichever way it moved", () => {
    for (const projected of ["2 (98)", "1 (30)"]) {
      const markup = draw({
        label: "combat COMB",
        value: "1 (53)",
        steps: [
          { value: "2 (90)", mark: "reported" },
          { value: projected, mark: "projected" }
        ]
      });
      const span = new RegExp(`<span class="([^"]*)">${projected.replace(/[()]/g, "\\$&")}`).exec(
        markup
      );
      expect(span?.[1]).toContain("text-select");
      expect(span?.[1]).not.toContain("text-ok");
      expect(span?.[1]).not.toContain("text-danger");
    }
  });

  // `ah-rgkk.4.3`: a ledger line carries a signed amount rather than a pair, and the sign already
  // says the direction - the ink is decoration on top of it.
  it("draws a signed amount in the ink its tone asks for", () => {
    expect(draw({ label: "taxed", value: "+200", tone: "up" })).toMatch(/text-ok[^>]*>\+200</);
    expect(draw({ label: "bought", value: "-90", tone: "down" })).toMatch(/text-danger[^>]*>-90</);
  });

  it("an uncertain projection carries a question mark", () => {
    const markup = draw({
      label: "combat COMB",
      value: "1 (53)",
      steps: [
        { value: "1 (53)", mark: "reported" },
        { value: "2 (98)", mark: "projected", uncertain: true }
      ]
    });
    expect(markup).toContain("2 (98)?");
  });

  it("draws an aside capacity dimmed", () => {
    const html = draw({ label: "can carry flying", value: "0", stress: "aside" });
    expect(html).toContain("text-ink-dim");
    expect(html).not.toContain("text-ink-soft");
  });
});

// `ah-2ql5`: the unfinished mark goes before whichever side of the line names the unfinished thing.
describe("the unfinished mark on a popup line", () => {
  const MARK = "data-unfinished-mark";

  it("goes before an unfinished building on the value side", () => {
    const markup = draw({ label: "structure", value: "Building [11] · Stockade", unfinished: "value" });
    expect(markup.indexOf(MARK)).toBeGreaterThan(-1);
    expect(markup.indexOf(MARK)).toBeLessThan(markup.indexOf("Building [11]"));
  });

  it("goes before an unfinished ship's own name on the label side", () => {
    const line: PopupLine = { label: "unfinished Galleon GALL", value: "1", unfinished: "label" };
    const label = renderToStaticMarkup(<PopupLineLabel line={line} />);
    expect(label.indexOf(MARK)).toBeLessThan(label.indexOf("unfinished Galleon"));
    expect(draw(line)).not.toContain(MARK);
  });

  it("is absent from every other line", () => {
    const line: PopupLine = { label: "wood WOOD", value: "85" };
    expect(draw(line)).not.toContain(MARK);
    expect(renderToStaticMarkup(<PopupLineLabel line={line} />)).not.toContain(MARK);
  });
});

// `ah-3aaj`: the Silver popup's opening lines - the first in ordinary ink, the rest dim.
describe("PopupCaveat", () => {
  it("draws the first line in ordinary ink and the next in the dim ink", () => {
    const markup = renderToStaticMarkup(<PopupCaveat caveat={["Why.", "How much."]} />);
    expect(markup).toMatch(/<p[^>]*>Why\.<\/p>/);
    expect(markup).not.toMatch(/text-ink-dim[^>]*>Why\./);
    expect(markup).toMatch(/text-ink-dim[^>]*>How much\./);
    expect(markup.indexOf("Why.")).toBeLessThan(markup.indexOf("How much."));
  });

  it("draws nothing without lines", () => {
    expect(renderToStaticMarkup(<PopupCaveat caveat={undefined} />)).toBe("");
  });
});

// `ah-w28r`: a row's dim side note sits on its own indented line beneath the row (B + S2 + L1).
describe("PopupRow", () => {
  const row = (line: PopupLine) => renderToStaticMarkup(<PopupRow line={line} />);
  const NOTE = /<p data-popup-side-note="true" class="([^"]*)">([^<]*)<\/p>/;

  it("draws a side note on its own indented, dim line beneath its row", () => {
    const markup = row({ label: "was lent for upkeep", value: "+50", tone: "up", why: "by Entertainers (1164)" });
    const note = NOTE.exec(markup);
    expect(note?.[2]).toBe("by Entertainers (1164)");
    expect(note?.[1]).toContain("pl-3");
    expect(note?.[1]).toContain("text-ink-dim");
    expect(markup.indexOf("+50")).toBeLessThan(markup.indexOf("by Entertainers"));
  });

  it("keeps the side note off the value side", () => {
    expect(draw({ label: "was lent", value: "+50", why: "by Transporter (11124)" })).not.toContain("Transporter");
  });

  it("draws a row with no side note as one line", () => {
    expect(row({ label: "upkeep", value: "-50", tone: "down" })).not.toContain("data-popup-side-note");
  });

  it("never breaks a row's name", () => {
    expect(renderToStaticMarkup(<PopupLineLabel line={{ label: "was lent for upkeep", value: "+50" }} />)).toContain(
      "whitespace-nowrap"
    );
  });

  it("keeps a struck row's note struck and an uncounted row's note italic", () => {
    const struck = row({ label: "Cloudship CLOU", value: "0-1", struck: true, why: "was: none" });
    expect(NOTE.exec(struck)?.[1]).toContain("line-through");
    expect(struck).toMatch(/line-through[^>]*>[^<]*Cloudship/);
    const uncounted = row({ label: "not counted", value: "50", uncounted: true, why: "sent to unit 123" });
    expect(NOTE.exec(uncounted)?.[1]).toContain("italic");
  });
});
