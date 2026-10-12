import { describe, expect, it } from "vitest";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import {
  castHalf,
  castMenu,
  castableAt,
  castsAfterChoice,
  castsLostAcross,
  castsLostToEdit
} from "./studyCast";
import type { SkillPoints } from "./studySchedule";

/**
 * A miniature ruleset: two foundations (automatic), a cast spell, a combat spell, a both-ways
 * spell and an automatic one, each in the shape ah-9qdz.1 writes (`data/FARS`, `data/FIRE`,
 * `data/CLEA`, `data/FORC`).
 */
const spell = (
  tag: string,
  name: string,
  use: string | null,
  requires: { tag: string; level: number }[] = [{ tag: "FORC", level: 1 }]
) => ({ tag, name, cost: 10, maxLevel: 5, produces: [], requires, magic: true, use });

const tree = buildMagicTree(
  parseGameData(
    JSON.stringify({
      skills: {
        FORC: spell("FORC", "force", "automatic", []),
        PATT: spell("PATT", "pattern", "automatic", []),
        BIRD: spell("BIRD", "bird lore", "cast"),
        CLEA: spell("CLEA", "clear skies", "both"),
        FARS: spell("FARS", "farsight", "cast"),
        FIRE: spell("FIRE", "fire", "combat"),
        SHIE: spell("SHIE", "force shield", "automatic"),
        OLDS: spell("OLDS", "old spell", null)
      },
      items: {},
      buildings: {}
    })
  ) as GameDataIndex
);

const knows = (levels: Record<string, number>): SkillPoints =>
  new Map(Object.entries(levels).map(([tag, level]) => [tag, { level, points: level * 30 }]));

describe("castableAt", () => {
  it("lists the cast, combat and both-ways spells he knows, in the study list's order, at his level", () => {
    const rows = castableAt(knows({ FORC: 2, FIRE: 2, FARS: 1, CLEA: 1, SHIE: 1, OLDS: 1 }), tree);

    expect(rows.map((row) => `${row.spell} ${row.name} ${row.level} ${row.detail}`)).toEqual(
      [...tree.byTag.keys()]
        .filter((tag) => ["CLEA", "FARS", "FIRE"].includes(tag))
        .map(
          (tag) =>
            ({
              CLEA: "CLEA clear skies 1 · cast or combat",
              FARS: "FARS farsight 1 · cast",
              FIRE: "FIRE fire 2 · combat"
            })[tag]
        )
    );
  });

  it("lists nothing he has not studied, nothing automatic and no foundation", () => {
    expect(castableAt(knows({ FORC: 3, PATT: 1, SHIE: 2, BIRD: 0 }), tree)).toEqual([]);
  });
});

describe("castHalf", () => {
  const half = (standing: SkillPoints, cast: string | null, turn = 26, mageName = "Ereb") =>
    castHalf({ mageName, turn, standing, tree, cast });

  it("is absent on a turn he knows no castable spell", () => {
    expect(half(knows({ FORC: 2 }), null)).toBeNull();
  });

  it("reads `✦ no cast`, with no hover, when nothing is planned", () => {
    expect(half(knows({ FORC: 1, FARS: 1 }), null)).toEqual({
      kind: "empty",
      label: "✦ no cast",
      title: null
    });
  });

  it("marks a cast spell ✦ and says he casts it", () => {
    expect(half(knows({ FORC: 1, FARS: 1 }), "FARS")).toEqual({
      kind: "planned",
      spell: "FARS",
      label: "✦ FARS",
      known: true,
      title: "Ereb casts farsight on turn 26."
    });
  });

  it("marks a combat-only spell ⚔ and says he readies it for battle", () => {
    expect(half(knows({ FORC: 1, FIRE: 2 }), "FIRE", 28)).toMatchObject({
      label: "⚔ FIRE",
      title: "Ereb readies fire for battle on turn 28."
    });
  });

  it("marks clear skies, which is both, ✦", () => {
    expect(half(knows({ FORC: 1, CLEA: 1 }), "CLEA")?.label).toBe("✦ CLEA");
  });

  it("keeps a spell he will not know yet, marked unknown, while he knows another", () => {
    expect(half(knows({ FORC: 1, BIRD: 1 }), "FARS", 28, "Sable")).toEqual({
      kind: "planned",
      spell: "FARS",
      label: "✦ FARS",
      known: false,
      title: "Sable won't know farsight by turn 28 — it's still planned, but he can't cast it."
    });
  });
});

describe("castMenu", () => {
  const menu = (standing: SkillPoints, current: string | null) =>
    castMenu({ mageName: "Ereb", turn: 28, standing, tree, current });

  it("heads the list with the mage and the turn, then `— no cast`, then his spells", () => {
    const opened = menu(knows({ FORC: 1, FARS: 1, FIRE: 2 }), "FIRE");

    expect(opened.heading).toBe("Ereb casts");
    expect(opened.chip).toBe("Turn 28");
    expect(opened.rows.map((row) => [row.spell, row.name, row.level, row.detail, row.pressed])).toEqual([
      [null, "— no cast", null, null, false],
      ...castableAt(knows({ FORC: 1, FARS: 1, FIRE: 2 }), tree).map((choice) => [
        choice.spell,
        choice.name,
        choice.level,
        choice.detail,
        choice.spell === "FIRE"
      ])
    ]);
  });

  it("ticks `— no cast` when nothing is planned", () => {
    expect(menu(knows({ FORC: 1, FARS: 1 }), null).rows[0].pressed).toBe(true);
  });

  it("lists a planned spell he will not know last, ticked, as not known by then", () => {
    const rows = menu(knows({ FORC: 1, BIRD: 1 }), "FARS").rows;

    expect(rows.at(-1)).toEqual({
      key: "FARS",
      spell: "FARS",
      name: "farsight",
      level: null,
      detail: "· not known by then",
      known: false,
      pressed: true
    });
    expect(rows.map((row) => row.spell)).toEqual([null, "BIRD", "FARS"]);
  });
});

describe("castsAfterChoice", () => {
  it("sets, replaces or clears one turn and leaves the others", () => {
    const casts = [
      { turn: 25, spell: "FARS" },
      { turn: 27, spell: "FIRE" }
    ];

    expect(castsAfterChoice(casts, 26, "CLEA")).toEqual([
      { turn: 25, spell: "FARS" },
      { turn: 26, spell: "CLEA" },
      { turn: 27, spell: "FIRE" }
    ]);
    expect(castsAfterChoice(casts, 27, "BIRD")).toEqual([
      { turn: 25, spell: "FARS" },
      { turn: 27, spell: "BIRD" }
    ]);
    expect(castsAfterChoice(casts, 25, null)).toEqual([{ turn: 27, spell: "FIRE" }]);
  });
});

describe("castsLostToEdit", () => {
  const empty = { kind: "empty" as const, label: "✦ no cast" as const, title: null };
  const lost = (before: (typeof empty | null)[], after: (typeof empty | null)[]) =>
    castsLostToEdit({
      casts: [
        { turn: 26, spell: "BIRD" },
        { turn: 27, spell: "BIRD" },
        { turn: 28, spell: "BIRD" },
        { turn: 40, spell: "BIRD" }
      ],
      before,
      after,
      turns: [26, 27, 28]
    });

  it("names a turn whose half the edit took away", () => {
    expect(lost([empty, empty, empty], [empty, null, empty])).toEqual([27]);
  });

  // Review finding 1: a half missing before the edit was lost to something else - the shelter
  // toggle, this month's orders, a ruleset that says nothing about uses - and is never pruned.
  it("keeps a cast whose half was already missing before the edit", () => {
    expect(lost([empty, null, null], [empty, null, null])).toEqual([]);
  });

  it("never names a turn outside the columns", () => {
    expect(lost([empty, empty, empty], [null, null, null])).toEqual([26, 27, 28]);
  });
});

// Review of PR #1516, round two: a teacher's edit can take a student's half away, so every mage's
// halves are compared, not only the edited one's.
describe("castsLostAcross", () => {
  const empty = { kind: "empty" as const, label: "✦ no cast" as const, title: null };

  it("names every mage whose half the edit took away, the student included", () => {
    expect(
      castsLostAcross({
        rows: [
          { key: "t", casts: [], castHalves: [empty, empty] },
          { key: "s", casts: [{ turn: 73, spell: "FIRE" }], castHalves: [empty, null] },
          { key: "u", casts: [{ turn: 73, spell: "BIRD" }], castHalves: [empty, null] }
        ],
        before: new Map([
          ["t", [empty, empty]],
          ["s", [empty, empty]],
          ["u", [empty, null]]
        ]),
        turns: [72, 73]
      })
    ).toEqual([{ rowKey: "s", turns: [73] }]);
  });

  it("leaves a mage the snapshot does not hold alone", () => {
    expect(
      castsLostAcross({
        rows: [{ key: "n", casts: [{ turn: 73, spell: "FIRE" }], castHalves: [empty, null] }],
        before: new Map(),
        turns: [72, 73]
      })
    ).toEqual([]);
  });
});
