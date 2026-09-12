import { describe, expect, it } from "vitest";
import type { DeclaredAttitudes } from "@atlantis/core-client";
import {
  NO_TEACHING_RULE,
  ownDeclarations,
  teachingDeclarerFor,
  teachingPermission,
  type TeachingRule
} from "./teachingPermission";

const attitudes = (defaultAttitude: string | null, named: Record<string, string>): DeclaredAttitudes => ({
  defaultAttitude,
  levels: Object.entries(named).map(([factionId, attitude]) => ({
    attitude,
    factions: [{ name: `Faction ${factionId}`, id: factionId }]
  }))
});

const tridentRule = (input: {
  ownFactionId: string | null;
  attitudes: DeclaredAttitudes | null;
  ordersDocument?: string;
}): TeachingRule => ({
  declarer: teachingDeclarerFor("newage-trident"),
  declarations: ownDeclarations({
    attitudes: input.attitudes,
    ownFactionId: input.ownFactionId,
    ordersDocument: input.ordersDocument ?? ""
  })
});

describe("which faction's declaration a world puts the teaching permission on", () => {
  it("puts it on the student under Trident and states none for any other world", () => {
    expect(teachingDeclarerFor("newage-trident")).toBe("student");
    expect(teachingDeclarerFor("newage-arcanum")).toBeNull();
    expect(teachingDeclarerFor("new-origins")).toBeNull();
    expect(teachingDeclarerFor(null)).toBeNull();
    expect(teachingDeclarerFor(undefined)).toBeNull();
  });
});

describe("teachingPermission", () => {
  it("permits Trident teaching only when our own faction declared the teacher's faction Friendly or Ally", () => {
    const verdict = (attitude: string | null) =>
      teachingPermission({
        rule: tridentRule({
          ownFactionId: "12",
          attitudes: attitude === null ? attitudes(null, {}) : attitudes(null, { "21": attitude })
        }),
        studentFactionId: "12",
        teacherFactionId: "21"
      });
    expect(verdict("Friendly")).toBe("permitted");
    expect(verdict("Ally")).toBe("permitted");
    expect(verdict("Neutral")).toBe("refused");
    expect(verdict("Unfriendly")).toBe("refused");
    expect(verdict("Hostile")).toBe("refused");
    expect(verdict(null)).toBe("unknown");
  });

  it("takes the declared default when no level names the teacher's faction", () => {
    expect(
      teachingPermission({
        rule: tridentRule({ ownFactionId: "12", attitudes: attitudes("Friendly", {}) }),
        studentFactionId: "12",
        teacherFactionId: "21"
      })
    ).toBe("permitted");
  });

  it("cannot answer when the student is not us: nothing we hold states an ally's declaration", () => {
    // We are the teacher; the student came from an ally's mage sheet, which carries no header.
    expect(
      teachingPermission({
        rule: tridentRule({ ownFactionId: "12", attitudes: attitudes("Friendly", { "21": "Ally" }) }),
        studentFactionId: "21",
        teacherFactionId: "12"
      })
    ).toBe("unknown");
    // And when the report names no faction of our own at all.
    expect(
      teachingPermission({
        rule: tridentRule({ ownFactionId: null, attitudes: attitudes("Friendly", {}) }),
        studentFactionId: "12",
        teacherFactionId: "21"
      })
    ).toBe("unknown");
  });

  it("needs no declaration within one faction, and none at all in a world stating no direction", () => {
    expect(
      teachingPermission({
        rule: tridentRule({ ownFactionId: "12", attitudes: attitudes("Hostile", {}) }),
        studentFactionId: "12",
        teacherFactionId: "12"
      })
    ).toBe("permitted");
    expect(
      teachingPermission({ rule: NO_TEACHING_RULE, studentFactionId: "12", teacherFactionId: "21" })
    ).toBe("permitted");
  });
});

describe("ownDeclarations", () => {
  it("overlays this turn's DECLARE orders onto the report's block", () => {
    expect(
      teachingPermission({
        rule: tridentRule({
          ownFactionId: "12",
          attitudes: attitudes(null, { "21": "Neutral" }),
          ordersDocument: "DECLARE 21 FRIENDLY"
        }),
        studentFactionId: "12",
        teacherFactionId: "21"
      })
    ).toBe("permitted");
  });

  it("lets a cancellation fall back onto a default the same document sets later", () => {
    const declarations = ownDeclarations({
      attitudes: attitudes("Hostile", { "21": "Neutral" }),
      ownFactionId: "12",
      ordersDocument: ["DECLARE 21", "DECLARE DEFAULT FRIENDLY"].join("\n")
    });
    expect(declarations.toward.has("21")).toBe(false);
    expect(declarations.fallback).toBe("friendly");
    expect(
      teachingPermission({
        rule: { declarer: "student", declarations },
        studentFactionId: "12",
        teacherFactionId: "21"
      })
    ).toBe("permitted");
  });
});

describe("an orders document belonging to another faction", () => {
  it("is not overlaid onto our own declarations", () => {
    const mine = ownDeclarations({
      attitudes: attitudes(null, { "21": "neutral" }),
      ownFactionId: "12",
      ordersDocument: ['#atlantis 12 "pass"', "DECLARE 21 FRIENDLY"].join("\n")
    });
    expect(mine.toward.get("21")).toBe("friendly");

    // The same DECLARE under somebody else's `#atlantis` line states their attitude, not ours.
    const theirs = ownDeclarations({
      attitudes: attitudes(null, { "21": "neutral" }),
      ownFactionId: "12",
      ordersDocument: ['#atlantis 34 "pass"', "DECLARE 21 FRIENDLY"].join("\n")
    });
    expect(theirs.toward.get("21")).toBe("neutral");

    // A document naming no faction is taken as ours: an unsaved or hand-started file looks like this.
    const unnamed = ownDeclarations({
      attitudes: attitudes(null, { "21": "neutral" }),
      ownFactionId: "12",
      ordersDocument: "DECLARE 21 FRIENDLY"
    });
    expect(unnamed.toward.get("21")).toBe("friendly");
  });
});
