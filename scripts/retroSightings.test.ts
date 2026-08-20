import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  beadIdFromRetroPath,
  citationsIn,
  dateOf,
  findings,
  formatReport,
  headlineOf,
  seenBeforeParagraphs,
  type Retro
} from "./retroSightings";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** A retrospective body, with the boilerplate the parser has to look past. */
function retro(beadId: string, date: string, headline: string, seenBefore: string): Retro {
  return {
    beadId,
    path: `docs/retrospectives/${beadId}.md`,
    text: [
      `# ${beadId} — retrospective`,
      "",
      "- **Implementer:** Cyclops",
      `- **Date:** ${date}`,
      "- **PR:** #1",
      "",
      `## ${headline}`,
      "",
      "**What happened.** Something.",
      "**Why.** Not established.",
      "**Cost.** An hour.",
      "**Prevent by.** Nothing yet.",
      `**Seen before.** ${seenBefore}`,
      ""
    ].join("\n")
  };
}

describe("seenBeforeParagraphs", () => {
  it("reads a Seen before paragraph that wraps across six lines", () => {
    const markdown = readFileSync(join(REPO, "docs", "retrospectives", "ah-58dz.md"), "utf8");
    const paragraphs = seenBeforeParagraphs(markdown);

    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toContain("ah-k6i.5 (same apt step, 20+ minutes)");
    expect(paragraphs[0]).toContain("which is probably what ah-bn6.1 hit.");
  });

  it("stops a paragraph at the next bold run-in rather than swallowing it", () => {
    const paragraphs = seenBeforeParagraphs(
      ["**Seen before.** ah-aaa,", "ah-bbb.", "**Prevent by.** ah-ccc should not be here."].join("\n")
    );

    expect(paragraphs).toEqual(["**Seen before.** ah-aaa,\nah-bbb."]);
  });

  it("returns one paragraph per finding when a file holds two sections", () => {
    const paragraphs = seenBeforeParagraphs(
      [
        "## First",
        "**Seen before.** ah-aaa",
        "",
        "## Second",
        "**Seen before.** ah-bbb"
      ].join("\n")
    );

    expect(paragraphs).toHaveLength(2);
  });
});

describe("citationsIn", () => {
  it("a None found paragraph cites nothing, even when it names beads", () => {
    const markdown = readFileSync(join(REPO, "docs", "retrospectives", "ah-3bl.md"), "utf8");
    const [paragraph] = seenBeforeParagraphs(markdown);

    expect(paragraph).toContain("ah-4ao");
    expect(citationsIn(paragraph)).toEqual([]);
  });

  it("a qualified None found still cites nothing", () => {
    expect(citationsIn("**Seen before.** none found for this one; ah-aaa is unrelated.")).toEqual([]);
  });

  it("reads a bead id however it is written", () => {
    const cited = citationsIn(
      "**Seen before.** ah-3c80, `ah-csni`, docs/retrospectives/ah-aao.md, and ah-2sy."
    );

    expect(cited).toEqual(["ah-3c80", "ah-csni", "ah-aao", "ah-2sy"]);
  });

  it("keeps a sub-bead suffix rather than reading it as a sentence end", () => {
    expect(citationsIn("**Seen before.** ah-8m0.2 and ah-k6i.5")).toEqual(["ah-8m0.2", "ah-k6i.5"]);
  });

  it("reads a bead id out of a retrospective filename carrying a role suffix", () => {
    expect(citationsIn("**Seen before.** docs/retrospectives/ah-wxk.1-verifier.md")).toEqual([
      "ah-wxk.1"
    ]);
  });
});

describe("headlineOf and dateOf", () => {
  it("reads the section headline and the date line", () => {
    const one = retro("ah-aaa", "2026-08-14", "the apt step hung", "None found");

    expect(headlineOf(one.text)).toBe("the apt step hung");
    expect(dateOf(one.text)).toBe("2026-08-14");
  });

  it("has no headline and no date when the file carries neither", () => {
    expect(headlineOf("**Seen before.** ah-aaa")).toBeNull();
    expect(dateOf("**Seen before.** ah-aaa")).toBeNull();
  });
});

describe("beadIdFromRetroPath", () => {
  it("reads a bead id out of a filename with a role suffix", () => {
    expect(beadIdFromRetroPath("docs/retrospectives/ah-wxk.1-verifier.md")).toBe("ah-wxk.1");
    expect(beadIdFromRetroPath("docs/retrospectives/ah-58dz.md")).toBe("ah-58dz");
  });
});

describe("findings", () => {
  it("a chain of five beads about one cause is one finding of five", () => {
    const found = findings([
      retro("ah-b", "2026-08-15", "second", "ah-a"),
      retro("ah-c", "2026-08-16", "third", "ah-b"),
      retro("ah-d", "2026-08-17", "fourth", "ah-c"),
      retro("ah-e", "2026-08-18", "fifth", "ah-d"),
      retro("ah-a", "2026-08-14", "the apt step hung", "None found")
    ]);

    expect(found).toHaveLength(1);
    expect(found[0].sightings).toBe(5);
    expect(found[0].beadIds).toEqual(["ah-a", "ah-b", "ah-c", "ah-d", "ah-e"]);
  });

  it("a citation naming ids the cited bead already names does not inflate the count", () => {
    const chain = [
      retro("ah-3c80", "2026-08-18", "the apt step hung", "ah-k6i.5, ah-bn6.1, ah-mjy, ah-vw63"),
      retro("ah-csni", "2026-08-19", "the apt step hung again", "ah-3c80")
    ];
    const transitive = [
      chain[0],
      retro(
        "ah-csni",
        "2026-08-19",
        "the apt step hung again",
        "ah-3c80 (which names ah-k6i.5, ah-bn6.1, ah-mjy, ah-vw63) — all the same step."
      )
    ];

    expect(findings(transitive)[0].beadIds).toEqual(findings(chain)[0].beadIds);
    expect(findings(transitive)[0].sightings).toBe(6);
  });

  it("counts a cited bead that wrote no retrospective of its own", () => {
    const found = findings([
      retro("ah-b", "2026-08-15", "second", "ah-a"),
      retro("ah-c", "2026-08-16", "third", "ah-a")
    ]);

    expect(found[0].beadIds).toEqual(["ah-a", "ah-b", "ah-c"]);
    expect(found[0].sightings).toBe(3);
  });

  it("leaves a cause sighted twice below the threshold", () => {
    const found = findings([
      retro("ah-a", "2026-08-14", "one", "None found"),
      retro("ah-b", "2026-08-15", "two", "ah-a")
    ]);

    expect(found).toEqual([]);
  });

  it("names a finding with the oldest sighting's own headline", () => {
    const found = findings([
      retro("ah-c", "2026-08-16", "the least useful description", "ah-a"),
      retro("ah-a", "2026-08-14", "the apt step hung for twenty minutes", "None found"),
      retro("ah-b", "2026-08-15", "middle", "ah-a")
    ]);

    expect(found[0].name).toEqual({
      beadId: "ah-a",
      headline: "the apt step hung for twenty minutes"
    });
    expect(found[0].last).toEqual({ beadId: "ah-c", date: "2026-08-16" });
  });

  it("has no name when no bead in the component wrote a headline", () => {
    const bare = (beadId: string, seen: string): Retro => ({
      beadId,
      path: `docs/retrospectives/${beadId}.md`,
      text: `**Seen before.** ${seen}`
    });
    const found = findings([bare("ah-a", "ah-x"), bare("ah-b", "ah-x"), bare("ah-c", "ah-x")]);

    expect(found[0].name).toBeNull();
  });

  it("puts the biggest finding first, then the most recent", () => {
    const found = findings([
      retro("ah-a", "2026-08-10", "small", "None found"),
      retro("ah-b", "2026-08-11", "small", "ah-a"),
      retro("ah-c", "2026-08-12", "small", "ah-a"),
      retro("ah-p", "2026-08-20", "big", "None found"),
      retro("ah-q", "2026-08-20", "big", "ah-p"),
      retro("ah-r", "2026-08-20", "big", "ah-p"),
      retro("ah-s", "2026-08-20", "big", "ah-p")
    ]);

    expect(found.map((finding) => finding.sightings)).toEqual([4, 3]);
  });
});

describe("formatReport", () => {
  const found = findings([
    retro("ah-a", "2026-08-14", "the apt step hung for twenty minutes", "None found"),
    retro("ah-b", "2026-08-15", "again", "ah-a"),
    retro("ah-c", "2026-08-16", "again", "ah-a")
  ]);

  it("prints one line per finding, count first", () => {
    const report = formatReport(found, new Set(), ["ah-c"]);

    expect(report).toContain("Repeated findings (3+ sightings)");
    expect(report).toMatch(/^ +3 +ah-a: the apt step hung for twenty minutes +last: ah-c$/mu);
    expect(report.split("\n").filter((line) => /ah-a:/u.test(line))).toHaveLength(1);
  });

  it("says nothing about a dismissed finding", () => {
    const report = formatReport(found, new Set(["ah-b"]), []);

    expect(report).not.toContain("ah-a:");
    expect(report).toContain("No finding has been sighted three times.");
  });

  it("counts the retrospectives written since the last sweep", () => {
    expect(formatReport(found, new Set(), ["ah-b", "ah-c"])).toContain(
      "2 new retrospectives since the last sweep"
    );
    expect(formatReport(found, new Set(), ["ah-c"])).toContain(
      "1 new retrospective since the last sweep"
    );
  });

  it("says every retrospective is new when there is no watermark", () => {
    expect(formatReport(found, new Set(), null)).toContain("every retrospective is new");
  });
});

describe("the committed corpus", () => {
  it("every retrospective carries at least one Seen before paragraph", () => {
    const directory = join(REPO, "docs", "retrospectives");
    const files = readdirSync(directory).filter(
      (name) => name.endsWith(".md") && name !== "README.md"
    );

    expect(files.length).toBeGreaterThan(0);

    const without = files.filter(
      (name) => seenBeforeParagraphs(readFileSync(join(directory, name), "utf8")).length === 0
    );

    expect(without).toEqual([]);
  });
});
