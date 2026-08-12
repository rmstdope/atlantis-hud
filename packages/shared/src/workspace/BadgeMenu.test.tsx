import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BadgeMenu } from "./BadgeMenu";
import { allBadges, BADGES } from "./mapThemes/hexView";

/**
 * What the badge popover offers, as markup.
 *
 * The repository has no jsdom, so clicking is the smoke suite's job; what is checkable here is
 * that every badge is present, that each checkbox says what the record says, and that the panel
 * carries the affordances a popover in this workspace is expected to have.
 */
function draw(badges = allBadges(true)): string {
  return renderToStaticMarkup(
    <BadgeMenu badges={badges} onToggle={() => {}} onSetAll={() => {}} onDismiss={() => {}} />
  );
}

describe("the badge popover", () => {
  it("offers one checkbox per badge, labelled", () => {
    const svg = draw();

    for (const { label } of BADGES) {
      expect(svg, label).toContain(label);
    }
    expect((svg.match(/type="checkbox"/g) ?? []).length).toBe(BADGES.length);
  });

  it("shows each box as the record has it, so the panel cannot disagree with the map", () => {
    const markup = draw(allBadges(true, { ships: false }));
    const boxes = new Map(
      [...markup.matchAll(/<input[^>]*data-badge="(\w+)"[^>]*>/g)].map((match) => [
        match[1],
        match[0].includes("checked")
      ])
    );

    expect(boxes.get("ships")).toBe(false);
    expect(boxes.get("buildings")).toBe(true);
    expect(boxes.size).toBe(BADGES.length);
  });

  it("offers All and None, because clearing nine boxes one at a time is not a control", () => {
    const markup = draw();

    expect(markup).toContain("All");
    expect(markup).toContain("None");
  });

  it("is a dialog hanging off its trigger, positioned so it cannot resize the chip strip", () => {
    // `readInsets` frames the map from the bounding box of the chip strip's overlay element, and
    // an open popover must not make the map fit itself into a smaller window.
    const markup = draw();

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="Badges"');
    expect(markup).toContain('data-testid="badge-menu"');
    expect(markup).toMatch(/class="[^"]*\babsolute\b/);
  });
});
