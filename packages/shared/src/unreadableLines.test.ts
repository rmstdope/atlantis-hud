import { describe, expect, it } from "vitest";
import type { ReportHeaderInfo, UnreadableLine } from "@atlantis/core-client";
import {
  unreadableFactionLabel,
  unreadableClipboardText,
  unreadableCostNote,
  unreadableKindLabel,
  unreadableLineRange,
} from "./unreadableLines";

function entry(over: Partial<UnreadableLine> = {}): UnreadableLine {
  return {
    kind: "unit",
    lineStart: 412,
    lineEnd: 412,
    text: "* Smiley :( (100), Wanderers (29), 10 humans [HUMN].",
    lost: null,
    ...over,
  };
}

describe("unreadableKindLabel", () => {
  it("names each kind with one capitalised word", () => {
    expect(unreadableKindLabel("region")).toBe("Region");
    expect(unreadableKindLabel("unit")).toBe("Unit");
    expect(unreadableKindLabel("structure")).toBe("Structure");
    expect(unreadableKindLabel("battle")).toBe("Battle");
    expect(unreadableKindLabel("attitude")).toBe("Attitude");
  });
});

describe("unreadableLineRange", () => {
  it("is the one line number when the record did not wrap", () => {
    expect(unreadableLineRange(entry())).toBe("412");
  });

  it("is an en-dashed range when it did", () => {
    expect(unreadableLineRange(entry({ lineStart: 998, lineEnd: 999 }))).toBe("998–999");
  });
});

describe("unreadableCostNote", () => {
  const lost = (furtherLines: number, units: number) =>
    entry({ kind: "region", lost: { furtherLines, units } });

  it("says what a lost hex took with it", () => {
    expect(unreadableCostNote(lost(34, 9))).toBe(
      "The whole hex was lost — 34 further lines, including 9 units.",
    );
  });

  it("is singular at one further line", () => {
    expect(unreadableCostNote(lost(1, 9))).toBe(
      "The whole hex was lost — 1 further line, including 9 units.",
    );
  });

  it("is singular at one unit", () => {
    expect(unreadableCostNote(lost(34, 1))).toBe(
      "The whole hex was lost — 34 further lines, including 1 unit.",
    );
  });

  it("is absent for every other kind", () => {
    expect(unreadableCostNote(entry())).toBeNull();
  });
});

describe("unreadableFactionLabel", () => {
  const header = (over: Partial<ReportHeaderInfo>) =>
    ({ factionName: null, factionId: null, ...over }) as ReportHeaderInfo;

  it("names both parts when the report has both", () => {
    expect(unreadableFactionLabel(header({ factionName: "Borg", factionId: "73" }))).toBe("Borg (73)");
  });

  it("is null when either part is missing", () => {
    expect(unreadableFactionLabel(header({ factionName: "Borg" }))).toBeNull();
    expect(unreadableFactionLabel(header({ factionId: "73" }))).toBeNull();
  });
});

describe("unreadableClipboardText", () => {
  const entries: UnreadableLine[] = [
    entry({
      kind: "attitude",
      lineStart: 86,
      lineEnd: 86,
      text: "Hostile : ?? (), Creatures (2).",
    }),
    entry(),
    entry({ lineStart: 1077, lineEnd: 1077, text: "- ?? (), Wanderers (29)." }),
    entry({
      kind: "region",
      lineStart: 998,
      lineEnd: 999,
      text: "mountain (,53) in Liou'ecpu, contains Rihead [city], 7922 peasants (hill dwarves), $4753.",
      lost: { furtherLines: 34, units: 9 },
    }),
    entry({ kind: "structure", lineStart: 1512, lineEnd: 1512, text: "+ Ruin [0] : closed." }),
    entry({
      kind: "battle",
      lineStart: 2244,
      lineEnd: 2244,
      text: "?? (, on guard, 12 orcs [ORC].",
    }),
  ];

  it("lays the whole block out in fixed columns, in ASCII", () => {
    expect(unreadableClipboardText(entries, 71, "Borg (73)")).toBe(
      [
        "6 lines of turn 71, Borg (73), could not be read:",
        "",
        "  attitude      86: Hostile : ?? (), Creatures (2).",
        "  unit         412: * Smiley :( (100), Wanderers (29), 10 humans [HUMN].",
        "  unit        1077: - ?? (), Wanderers (29).",
        "  region   998-999: mountain (,53) in Liou'ecpu, contains Rihead [city], 7922 peasants (hill dwarves), $4753.",
        "                    (the whole hex was lost - 34 further lines, including 9 units)",
        "  structure   1512: + Ruin [0] : closed.",
        "  battle      2244: ?? (, on guard, 12 orcs [ORC].",
      ].join("\n"),
    );
  });

  it("names the turn alone when the report does not name the faction", () => {
    expect(unreadableClipboardText([entry()], 71, null).split("\n")[0]).toBe(
      "1 line of turn 71 could not be read:",
    );
  });

  it("names neither when the report names no turn at all", () => {
    expect(unreadableClipboardText([entry()], null, null).split("\n")[0]).toBe(
      "1 line of this report could not be read:",
    );
    expect(unreadableClipboardText(entries, null, "Borg (73)").split("\n")[0]).toBe(
      "6 lines of this report could not be read:",
    );
  });
});
