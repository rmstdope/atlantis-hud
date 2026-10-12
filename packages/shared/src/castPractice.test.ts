import { describe, expect, it } from "vitest";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import { practisedBy } from "./castPractice";
import type { SkillPoints } from "./studySchedule";

/**
 * Which skill a cast practises, after the engine's `Unit::Practice` (../Atlantis/unit.cpp:1384),
 * confirmed by the navigator for New Age (2026-10-12): the spell itself, or the first prerequisite
 * in declaration order whose level is at or below the spell's (tested the same way, recursively),
 * or nothing at the spell's maximum. `rules/skills_studying` (New Age: Trident): practice needs the
 * rudiments studied first.
 */
const skill = (
  tag: string,
  name: string,
  requires: { tag: string; level: number }[],
  maxLevel = 5
) => ({ tag, name, cost: 10, maxLevel, produces: [], requires, magic: true, use: "cast" });

const tree = buildMagicTree(
  parseGameData(
    JSON.stringify({
      skills: {
        FORC: skill("FORC", "force", []),
        PATT: skill("PATT", "pattern", []),
        SPIR: skill("SPIR", "spirit", []),
        FIRE: skill("FIRE", "fire", [{ tag: "FORC", level: 1 }]),
        ILLU: skill("ILLU", "illusion", [
          { tag: "FORC", level: 1 },
          { tag: "PATT", level: 1 }
        ]),
        INVI: skill("INVI", "invisibility", [{ tag: "ILLU", level: 3 }]),
        // A foundation capped at 2 in this miniature, so a qualifying prerequisite can fail.
        CAPD: skill("CAPD", "capped", [], 2),
        ODDS: skill("ODDS", "odd spell", [
          { tag: "CAPD", level: 1 },
          { tag: "SPIR", level: 1 }
        ])
      },
      items: {},
      buildings: {}
    })
  ) as GameDataIndex
);

const knows = (levels: Record<string, number>): SkillPoints =>
  new Map(Object.entries(levels).map(([tag, level]) => [tag, { level, points: level * 30 }]));

describe("practisedBy", () => {
  it("gives the days to force while force is not above fire", () => {
    expect(practisedBy("FIRE", knows({ FORC: 1, FIRE: 1 }), tree)).toEqual({
      kind: "prerequisite",
      tag: "FORC"
    });
  });

  it("gives the days to fire itself once force is above it", () => {
    expect(practisedBy("FIRE", knows({ FORC: 2, FIRE: 1 }), tree)).toEqual({
      kind: "self",
      tag: "FIRE"
    });
  });

  it("gives nothing at the spell's highest level", () => {
    expect(practisedBy("FIRE", knows({ FORC: 5, FIRE: 5 }), tree)).toEqual({
      kind: "none",
      tag: null
    });
  });

  it("gives nothing for a spell he has not studied", () => {
    expect(practisedBy("FIRE", knows({ FORC: 2 }), tree)).toEqual({ kind: "none", tag: null });
  });

  it("takes the first qualifying prerequisite in declaration order", () => {
    expect(practisedBy("ILLU", knows({ FORC: 1, PATT: 1, ILLU: 1 }), tree)).toEqual({
      kind: "prerequisite",
      tag: "FORC"
    });
    expect(practisedBy("ILLU", knows({ FORC: 2, PATT: 1, ILLU: 1 }), tree)).toEqual({
      kind: "prerequisite",
      tag: "PATT"
    });
  });

  it("follows a chain to the skill that actually gains", () => {
    // INVI 3 -> ILLU 3 qualifies -> FORC 3 qualifies under ILLU -> force gains.
    expect(practisedBy("INVI", knows({ FORC: 3, PATT: 4, ILLU: 3, INVI: 3 }), tree)).toEqual({
      kind: "prerequisite",
      tag: "FORC"
    });
  });

  it("goes on to a later prerequisite when an earlier qualifying one cannot gain", () => {
    // CAPD is at its maximum of 2, so it fails; SPIR 2 also qualifies and takes the days
    // (unit.cpp:1450-1462 keeps looping after a failed prerequisite).
    expect(practisedBy("ODDS", knows({ CAPD: 2, SPIR: 2, ODDS: 2 }), tree)).toEqual({
      kind: "prerequisite",
      tag: "SPIR"
    });
  });

  it("gives nothing when every qualifying prerequisite fails, though the spell is below its highest", () => {
    expect(practisedBy("ODDS", knows({ CAPD: 2, SPIR: 3, ODDS: 2 }), tree)).toEqual({
      kind: "none",
      tag: null
    });
  });

  it("reads the spell's tag in any case", () => {
    expect(practisedBy("fire", knows({ FORC: 2, FIRE: 1 }), tree)).toEqual({
      kind: "self",
      tag: "FIRE"
    });
  });
});
