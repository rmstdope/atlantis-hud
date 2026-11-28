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

function render(attacks: AttackView[], selectedKey: string | null = attacks[0]?.key ?? null) {
  const html = renderToStaticMarkup(
    <AttacksDialog
      attacks={attacks}
      selectedKey={selectedKey}
      onSelect={() => {}}
      onShowOnMap={() => {}}
      onGoToUnit={() => {}}
      onDismiss={() => {}}
    />
  );
  // The text a person reads, with tags stripped and runs of spaces collapsed.
  return { html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") };
}

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

  it("draws the three groups in order, with men, roles, reasons and warnings", () => {
    const { text, html } = render([
      view({
        frontline: [
          unit({ reasons: ["gave the order"], role: "melee, ranged" }),
          unit({
            unitId: "840",
            name: "Porters",
            men: 25,
            role: "non-combatant",
            warning: "non-combatant in the frontline: likely to be cut down"
          })
        ],
        backline: [unit({ unitId: "820", name: "Archers", men: 12, role: "ranged" })],
        out: [unit({ unitId: "818", name: "Scouts", men: 1, role: "non-combatant", reasons: ["avoiding"] })]
      })
    ]);
    const front = text.indexOf("Frontline — 2 units, 45 men");
    const back = text.indexOf("Backline — 1 unit, 12 men");
    const out = text.indexOf("Will not fight — 1 unit, 1 man");
    expect(front).toBeGreaterThan(-1);
    expect(back).toBeGreaterThan(front);
    expect(out).toBeGreaterThan(back);
    expect(text).toContain("Raiders (812) · 20 men · melee, ranged gave the order");
    expect(text).toContain("! Porters (840) · 25 men · non-combatant non-combatant in the frontline: likely to be cut down");
    expect(text).toContain("Can only shoot or cast spells until the frontline falls.");
    expect(text).toContain("Scouts (818) · 1 man · non-combatant avoiding");
    expect(html).toContain('data-testid="attack-unit-840"');
    expect(text).toContain("Click a unit to go to it.");
  });

  it("leaves out an empty Backline and says when nobody stays out", () => {
    const { text } = render([view()]);
    expect(text).not.toContain("Backline");
    expect(text).toContain("Will not fight — none Every unit of yours that could join will.");
  });

  it("joins several reasons on one unit", () => {
    const { text } = render([
      view({ backline: [unit({ reasons: ["from Plain (12,3)", "set by BEHIND 1 in your orders"] })] })
    ]);
    expect(text).toContain("from Plain (12,3); set by BEHIND 1 in your orders");
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
