import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AttackView, MusterUnit } from "../attackMuster";
import { AttacksDialog } from "./AttacksDialog";

const unit = (overrides: Partial<MusterUnit>): MusterUnit => ({
  unitId: "812",
  regionId: "1:12,4",
  name: "Raiders",
  men: 20,
  role: "melee",
  reasons: [],
  warning: null,
  ...overrides
});

const view = (overrides: Partial<AttackView> = {}): AttackView => ({
  key: "812",
  attackerId: "812",
  attackerName: "Raiders",
  regionId: "1:12,4",
  hex: "Plain (12,4)",
  targets: ["Bandits (1203)", "Bandits (1204)"],
  missingTargets: [],
  allies: [],
  withdraws: false,
  frontline: [unit({ reasons: ["gave the order"] })],
  backline: [],
  out: [],
  ...overrides
});

const SPIES = view({
  key: "1022",
  attackerId: "1022",
  attackerName: "Spies",
  hex: "Forest (13,5)",
  targets: ["Guardsmen (77)"]
});

function render(
  attacks: AttackView[],
  selectedKey: string | null = attacks[0]?.key ?? null,
  compact = false
) {
  const html = renderToStaticMarkup(
    <AttacksDialog
      attacks={attacks}
      selectedKey={selectedKey}
      compact={compact}
      onToggleCompact={() => {}}
      onSelect={() => {}}
      onShowOnMap={() => {}}
      onGoToUnit={() => {}}
      onDismiss={() => {}}
    />
  );
  // The text a person reads, with tags stripped and runs of spaces collapsed.
  return { html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") };
}

/** The markup of one group's card. */
const card = (html: string, group: string) =>
  new RegExp(`<section[^>]*data-testid="attack-group-${group}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? "";

/** The markup of one unit's row button. */
const row = (html: string, unitId: string) =>
  new RegExp(`<button[^>]*data-testid="attack-unit-${unitId}"[^>]*>([\\s\\S]*?)</button>`).exec(html) ?? null;

const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const SCOUT_WARNING = "ranged in the frontline: could stand in the backline, safe until the frontline falls";

const BUSY = view({
  frontline: [
    unit({ reasons: ["gave the order"], role: "melee, ranged" }),
    unit({
      unitId: "822",
      name: "Wagoneers",
      men: 8,
      role: "non-combatant",
      warning: "non-combatant in the frontline: likely to be cut down",
      reasons: ["from Forest (11,12), if they can reach the battle"]
    })
  ],
  backline: [unit({ unitId: "820", name: "Archers", men: 12, role: "ranged" })],
  out: [unit({ unitId: "818", name: "Scouts", men: 1, role: "non-combatant", reasons: ["avoiding"] })]
});

describe("the Attacks window", () => {
  it("counts the attacks in its bar and lists one row per attacking unit", () => {
    const { text, html } = render([view(), SPIES]);
    expect(text).toContain("Attacks · 2 in your orders");
    expect(text).toContain("Raiders (812) → Bandits (1203), Bandits (1204) Plain (12,4)");
    expect(text).toContain("Spies (1022) → Guardsmen (77) Forest (13,5)");
    expect(html).toContain('data-testid="attack-row-812"');
    expect(html).toMatch(/data-testid="attack-row-812"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-testid="attack-row-812"/);
  });

  it("shows the selected attack, falling back to the first row", () => {
    expect(render([view(), SPIES], "1022").text).toContain("Spies (1022) attacks Guardsmen (77)");
    expect(render([view(), SPIES], "gone").text).toContain(
      "Raiders (812) attacks Bandits (1203), Bandits (1204) in Plain (12,4) · show on map"
    );
  });

  it("draws each group as its own card, in order, headed by its name and count", () => {
    const { text, html } = render([BUSY]);
    const front = text.indexOf("Frontline 2 units · 28 men");
    const back = text.indexOf("Backline 1 unit · 12 men");
    const out = text.indexOf("Will not fight 1 unit · 1 man");
    expect(front).toBeGreaterThan(-1);
    expect(back).toBeGreaterThan(front);
    expect(out).toBeGreaterThan(back);
    // Brass left edge for the two lines, red for those left out; the heading in capitals, its colour.
    expect(card(html, "frontline")).toMatch(/^<section[^>]*border-l-4[^>]*border-l-brass/);
    expect(card(html, "backline")).toMatch(/^<section[^>]*border-l-brass/);
    expect(card(html, "out")).toMatch(/^<section[^>]*border-l-danger/);
    expect(card(html, "out")).toMatch(/<h3[^>]*uppercase[^>]*text-danger/);
    expect(card(html, "frontline")).toMatch(/<h3[^>]*uppercase[^>]*text-brass/);
    expect(strip(card(html, "backline"))).toContain("Can only shoot or cast spells until the frontline falls.");
    expect(text).toContain("Click a unit to go to it.");
  });

  it("draws one row per unit: mark, unit, men, role, then the note", () => {
    const { html } = render([BUSY]);
    expect(strip(row(html, "812")?.[1] ?? "")).toBe("Raiders (812) 20 melee, ranged gave the order");
    // The warning first, in amber, then the reason; the "!" marks it.
    expect(strip(row(html, "822")?.[1] ?? "")).toBe(
      "! Wagoneers (822) 8 non-combatant non-combatant in the frontline: likely to be cut down from Forest (11,12), if they can reach the battle"
    );
    expect(row(html, "822")?.[1]).toMatch(/class="[^"]*text-warn[^"]*">non-combatant in the frontline/);
    expect(row(html, "822")?.[1]).toMatch(/class="[^"]*text-ink-dim[^"]*">from Forest/);
    // Under Will not fight the reason is red.
    expect(row(html, "818")?.[1]).toMatch(/class="[^"]*text-danger[^"]*">avoiding/);
  });

  it("draws the unit number in blue beside an underlined name, as the mockup does", () => {
    const button = row(render([view()]).html, "812")?.[1] ?? "";
    expect(button).toMatch(/<span class="[^"]*underline[^"]*">Raiders<\/span>/);
    expect(button).toMatch(/<span class="text-select">\(812\)<\/span>/);
    // Only the name is underlined, not the whole row.
    expect(/^<button[^>]*>/.exec(row(render([view()]).html, "812")?.[0] ?? "")?.[0]).not.toContain("underline");
  });

  it("makes the whole row the button, lit on hover and on keyboard focus", () => {
    const button = row(render([view()]).html, "812")?.[0] ?? "";
    expect(button).toMatch(/class="[^"]*\bgrid\b/);
    for (const look of ["cursor-pointer", "hover:bg-select/15", "focus-visible:bg-select/15"]) {
      expect(button).toContain(look);
    }
  });

  it("wraps a long note in its own column unless Compact view is on", () => {
    const wide = view({ frontline: [unit({ warning: SCOUT_WARNING, reasons: ["from Plain (12,3)"] })] });
    const normal = render([wide]).html;
    expect(normal).not.toContain('data-testid="attack-note-812"');
    expect(row(normal, "812")?.[1]).toContain("from Plain (12,3)");

    const compact = render([wide], "812", true).html;
    const note = /<span[^>]*data-testid="attack-note-812"[^>]*>([\s\S]*?)<\/span>/.exec(compact);
    // One line, cut short, the warning shown and both on hover.
    expect(note?.[0]).toContain("truncate");
    expect(note?.[0]).toContain(`title="${SCOUT_WARNING}\nfrom Plain (12,3)"`);
    expect(note?.[1]).toBe(SCOUT_WARNING);
    expect(row(compact, "812")?.[1]).not.toContain("from Plain (12,3)<");
    // A row with nothing to say carries no empty hover text.
    expect(render([view({ frontline: [unit({})] })], "812", true).html).not.toContain('title=""');
  });

  it("offers Compact view in the bar, ticked as the setting is, even with no attacks", () => {
    const checkbox = (html: string) => /<input[^>]*data-testid="attacks-compact"[^>]*>/.exec(html)?.[0] ?? "";
    expect(render([view()]).text).toContain("Compact view");
    expect(checkbox(render([view()]).html)).toContain('type="checkbox"');
    expect(checkbox(render([view()]).html)).not.toContain("checked");
    expect(checkbox(render([view()], "812", true).html)).toContain('checked=""');
    expect(checkbox(render([], null).html)).toContain('type="checkbox"');
    // In the bar, before the close button.
    const { html } = render([view()]);
    expect(html.indexOf('data-testid="attacks-compact"')).toBeLessThan(html.indexOf('data-testid="attacks-close"'));
  });

  it("says standing behind has no effect when the Frontline is empty", () => {
    const { text } = render([
      view({ frontline: [], backline: [unit({ reasons: ["gave the order"] })] })
    ]);
    expect(text).toContain(
      "Frontline none Backline 1 unit · 20 men With no frontline, standing behind has no effect: these units fight as if in front."
    );
    expect(text).not.toContain("Can only shoot or cast spells");
  });

  it("leaves out an empty Backline and says when nobody stays out", () => {
    const { text, html } = render([view()]);
    expect(text).not.toContain("Backline");
    expect(text).toContain("Will not fight none Every unit of yours that could join will.");
    expect(card(html, "out")).not.toContain("<li");
  });

  it("puts a red banner instead of the groups when the attack is on an ally", () => {
    const { text, html } = render([view({ allies: [{ id: "31", name: "Bandit Kings" }], withdraws: true })]);
    expect(text).toContain(
      "You have declared Bandit Kings (31) an ally. Your units will withdraw instead of attacking them."
    );
    expect(text).not.toContain("Frontline");
    expect(text).not.toContain("Will not fight");
    expect(html).toContain("text-danger");
  });

  it("puts an amber banner above the groups for a target not in the hex", () => {
    const { text } = render([view({ targets: ["unit 1203"], missingTargets: ["1203"] })]);
    expect(text).toContain("Raiders (812) attacks unit 1203");
    expect(text).toContain(
      "Unit 1203 is not in Plain (12,4) in this report. The attack happens only if Raiders can see it there."
    );
    expect(text.indexOf("not in Plain")).toBeLessThan(text.indexOf("Frontline"));
  });

  it("says so when the orders hold no attacks any more", () => {
    const { text } = render([], null);
    expect(text).toContain("Attacks · none in your orders");
    expect(text).toContain("Your orders have no attacks.");
  });
});
