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
function draw(badges = allBadges(true), biomeSymbols = false): string {
  return renderToStaticMarkup(
    <BadgeMenu
      badges={badges}
      onToggle={() => {}}
      onSetAll={() => {}}
      biomeSymbols={biomeSymbols}
      onToggleBiomeSymbols={() => {}}
    />
  );
}

describe("the badge popover", () => {
  it("offers one checkbox per badge, labelled", () => {
    const svg = draw();

    for (const { label } of BADGES) {
      expect(svg, label).toContain(label);
    }
    // One more than the badges: the biome symbols row under its own heading (ah-d9jb.4).
    expect((svg.match(/type="checkbox"/g) ?? []).length).toBe(BADGES.length + 1);
  });

  it("lists Regions among the badges, for the province outlines on the map", () => {
    const svg = draw();

    expect(svg).toContain("Regions");
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

describe("the biome symbols row (ah-d9jb.4)", () => {
  it("sits under a Terrain heading of its own, below every badge", () => {
    const markup = draw();
    const notes = markup.indexOf("Notes");
    const divider = markup.indexOf("<hr");
    const heading = markup.indexOf(">Terrain<");
    const row = markup.indexOf("Biome symbols");

    expect(notes).toBeGreaterThan(-1);
    expect(divider).toBeGreaterThan(notes);
    expect(heading).toBeGreaterThan(divider);
    expect(row).toBeGreaterThan(heading);
  });

  it("is a checkbox showing whether the symbols are on", () => {
    const box = (markup: string) =>
      /<input[^>]*data-setting="biome-symbols"[^>]*>/.exec(markup)?.[0] ?? "";

    expect(box(draw(allBadges(true), false))).not.toContain("checked");
    expect(box(draw(allBadges(true), true))).toContain("checked");
    expect(box(draw())).toContain('type="checkbox"');
  });

  it("is not a badge, so All, None and the lit chip leave it out", () => {
    const markup = draw();

    expect(/<input[^>]*data-setting="biome-symbols"[^>]*>/.exec(markup)?.[0]).not.toContain(
      "data-badge"
    );
    expect((markup.match(/data-badge="/g) ?? []).length).toBe(BADGES.length);
  });

  it("adds no other words: no tooltip, legend or message", () => {
    const markup = draw();

    expect(markup).not.toMatch(/title="/);
    expect(markup.slice(markup.indexOf("<hr"))).not.toMatch(/>[^<]*(legend|symbol key)[^<]*</i);
  });
});
