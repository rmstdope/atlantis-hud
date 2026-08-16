import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Battle } from "@atlantis/core-client";
import { BattlesDialog } from "./BattlesDialog";

const hexLabel = (regionId: string) => `hex ${regionId}`;

const FIRST: Battle = {
  headline: "AA Tomb's Guards (7280) attacks Pirates (14789) in ocean (25,55) in Atlantis Ocean!",
  attacker: { name: "AA Tomb's Guards", id: "7280" },
  defender: { name: "Pirates", id: "14789" },
  terrain: "ocean",
  coordinate: { x: 25, y: 55, z: 1 },
  province: "Atlantis Ocean",
  attackers: [
    {
      name: "AA Tomb's Guards",
      id: "7280",
      faction: { name: "Greywolf", id: "33" },
      flags: [],
      body: "78 gnolls [GNOL], combat 5"
    },
    {
      name: "One of Eight",
      id: "18636",
      faction: { name: "Borg TNG", id: "95" },
      flags: ["LEAD"],
      body: "leather armor"
    },
    {
      name: "Ailen's Acolyte",
      id: "2965",
      faction: null,
      flags: ["LEAD"],
      body: "mithril sword [MSWO]"
    }
  ],
  defenders: [
    {
      name: "Pirates",
      id: "14789",
      faction: { name: "Pirates", id: "0" },
      flags: [],
      body: "15 sailors [SAIL]"
    }
  ],
  rounds: [
    {
      number: 1,
      lines: ["AA Tomb's Guards (7280) tactics bonus 3.", "Adonin (1392) casts Energy Shield."],
      losses: [
        { combatant: { name: "Pirates", id: "14789" }, lost: 15, text: "Pirates (14789) loses 15" },
        {
          combatant: { name: "AA Tomb's Guards", id: "7280" },
          lost: 0,
          text: "AA Tomb's Guards (7280) loses 0"
        }
      ],
      statistics: Array.from({ length: 17 }, (_, index) => `stat line ${index}`)
    }
  ],
  statistics: Array.from({ length: 44 }, (_, index) => `battle stat line ${index}`),
  casualties: [
    { combatant: { name: "Pirates", id: "14789" }, lost: 15, text: "Pirates (14789) loses 15" },
    {
      combatant: { name: "AA Tomb's Guards", id: "7280" },
      lost: 0,
      text: "AA Tomb's Guards (7280) loses 0"
    }
  ],
  damagedUnits: ["14789"],
  spoils: "3 magic crossbows [MXBO], 2531 silver [SILV]",
  lineStart: 10,
  lineEnd: 200,
  assassination: false
};

const SECOND: Battle = {
  ...FIRST,
  headline: "Sail (16352) attacks Looter (16779) in ocean (26,52) in Atlantis Ocean!",
  attacker: { name: "Sail", id: "16352" },
  defender: { name: "Looter", id: "16779" },
  coordinate: { x: 26, y: 52, z: 1 },
  attackers: [],
  defenders: [],
  rounds: [],
  statistics: [],
  casualties: [
    { combatant: { name: "Looter", id: "16779" }, lost: 1, text: "Looter (16779) loses 1" },
    { combatant: { name: "Sail", id: "16352" }, lost: 0, text: "Sail (16352) loses 0" }
  ],
  damagedUnits: ["16779"],
  spoils: "271 silver [SILV]"
};

function draw(
  props: Partial<Parameters<typeof BattlesDialog>[0]> & { battles: Battle[] }
): string {
  return renderToStaticMarkup(
    <BattlesDialog
      selectedIndex={0}
      onSelect={() => {}}
      hexLabel={hexLabel}
      viewerFactionId="95"
      onShowOnMap={() => {}}
      onDismiss={() => {}}
      {...props}
    />
  );
}

describe("the battles dialog", () => {
  it("is a dialog with an accessible name", () => {
    const markup = draw({ battles: [FIRST, SECOND] });

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="Battles"');
  });

  it("lists every battle with its hex and its losses, the first marked selected", () => {
    const markup = draw({ battles: [FIRST, SECOND] });

    expect(markup).toContain("Guards (7280)");
    expect(markup).toContain("Pirates (14789)");
    expect(markup).toContain("hex 1:25,55");
    expect(markup).toContain("Sail (16352)");
    expect(markup).toContain("Looter (16779)");
    expect(markup).toContain("hex 1:26,52");

    const rowMatch = /<[^>]*data-testid="battle-row-0"[^>]*>/.exec(markup);
    expect(rowMatch?.[0]).toContain('aria-selected="true"');
    const secondRowMatch = /<[^>]*data-testid="battle-row-1"[^>]*>/.exec(markup);
    expect(secondRowMatch?.[0]).toContain('aria-selected="false"');
  });

  it("shows the selected battle in full: both rosters with counts, own units marked", () => {
    const markup = draw({ battles: [FIRST, SECOND], selectedIndex: 0 });

    expect(markup).toContain("Attackers");
    expect(markup).toContain("3");
    expect(markup).toContain("1 yours");
    expect(markup).toContain("Defenders");
    expect(markup).toContain("One of Eight (18636)");
    expect(markup).toContain("faction not shown");
  });

  it("shows the round's lines and its loss line", () => {
    const markup = draw({ battles: [FIRST, SECOND], selectedIndex: 0 });

    expect(markup).toContain("tactics bonus 3.");
    expect(markup).toContain("Adonin (1392) casts Energy Shield.");
    expect(markup).toContain("Pirates (14789) loses 15");
  });

  it("shows total casualties, damaged units and spoils", () => {
    const markup = draw({ battles: [FIRST, SECOND], selectedIndex: 0 });

    expect(markup).toContain("14789");
    expect(markup).toContain("3 magic crossbows [MXBO], 2531 silver [SILV]");
  });

  it("keeps both statistics blocks folded away, saying how many lines each holds", () => {
    const markup = draw({ battles: [FIRST, SECOND], selectedIndex: 0 });

    // <details> without an `open` attribute renders collapsed.
    const detailsBlocks = [...markup.matchAll(/<details[^>]*>/g)];
    expect(detailsBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of detailsBlocks) {
      expect(block[0]).not.toContain("open");
    }
    expect(markup).toContain("Round 1 statistics (17 lines)");
    expect(markup).toContain("Battle statistics (44 lines)");
  });

  it("offers a way to the battle's hex", () => {
    const markup = draw({ battles: [FIRST, SECOND], selectedIndex: 0 });

    expect(markup).toContain("show on map");
  });

  it("says plainly when a turn had no battles, rather than drawing an empty rail", () => {
    const markup = draw({ battles: [] });

    expect(markup).toContain("no battles");
    expect(markup).not.toContain('data-testid="battle-row-0"');
  });

  it("puts the outcome before the round-by-round detail", () => {
    const markup = draw({ battles: [FIRST], selectedIndex: 0 });

    const outcomeIndex = markup.indexOf("Outcome");
    const roundsIndex = markup.indexOf("Rounds");
    expect(outcomeIndex).toBeGreaterThan(-1);
    expect(roundsIndex).toBeGreaterThan(-1);
    expect(outcomeIndex).toBeLessThan(roundsIndex);
  });

  it("shows an assassination with an unknown attacker, the victim as defender and real casualties", () => {
    const assassination: Battle = {
      ...FIRST,
      headline: "L Arslan (1446) is assassinated in forest (43,79) in Utso!",
      attacker: null,
      defender: { name: "L Arslan", id: "1446" },
      terrain: "forest",
      coordinate: { x: 43, y: 79, z: 1 },
      province: "Utso",
      attackers: [],
      defenders: [],
      rounds: [],
      statistics: [],
      casualties: [],
      damagedUnits: [],
      spoils: null,
      assassination: true
    };

    const markup = draw({ battles: [assassination], selectedIndex: 0 });

    expect(markup).toContain("?");
    expect(markup).toContain("L Arslan (1446)");
    expect(markup).toContain("L Arslan (1446) is assassinated");
  });

  it("labels a free round without inventing a number", () => {
    const routed: Battle = {
      ...FIRST,
      rounds: [
        {
          number: null,
          lines: ["Pirates (14789) is routed!"],
          losses: [],
          statistics: ["stat line"]
        }
      ]
    };

    const markup = draw({ battles: [routed], selectedIndex: 0 });

    expect(markup).toContain("Free round");
    expect(markup).toContain("Free round statistics (1 line)");
  });

  it("keeps roster rows from shrinking to fit, so a long roster scrolls instead of compressing", () => {
    const markup = draw({ battles: [FIRST, SECOND], selectedIndex: 0 });

    const rows = [...markup.matchAll(/<li[^>]*>/g)].filter((match) =>
      match[0].includes("overflow-hidden")
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row[0]).toContain("shrink-0");
    }
  });
});
