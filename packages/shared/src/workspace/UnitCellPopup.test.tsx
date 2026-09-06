import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PopupLine } from "../unitCellPopup";
import { PopupLineValue } from "./UnitCellPopup";

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
