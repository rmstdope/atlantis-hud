import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexFindings } from "../orderEditor";
import { ProblemsList } from "./ProblemsList";

const HEXES: HexFindings[] = [
  {
    regionId: "1:7,53",
    findings: [
      {
        code: "not-enough-silver",
        message: "spends 250 silver it has not got",
        lineStart: 3,
        lineEnd: 3,
        columnStart: 0,
        columnEnd: 4,
        regionId: "1:7,53",
        unitId: "2042",
        formed: null,
        severity: "warning"
      },
      {
        code: "hex-unguarded",
        message: "nobody is guarding this hex",
        lineStart: null,
        lineEnd: null,
        columnStart: null,
        columnEnd: null,
        regionId: "1:7,53",
        unitId: null,
        formed: null,
        severity: "warning"
      }
    ]
  },
  {
    regionId: "1:12,48",
    findings: [
      {
        code: "bad-direction",
        message: "no such direction",
        lineStart: 7,
        lineEnd: 7,
        columnStart: 5,
        columnEnd: 8,
        regionId: "1:12,48",
        unitId: "3310",
        formed: null,
        severity: "error"
      }
    ]
  }
];

const drawHexes = () =>
  renderToStaticMarkup(
    <ProblemsList
      hexes={HEXES}
      labelFor={(regionId) => regionId}
      onSelectHex={() => {}}
      onDismiss={() => {}}
    />
  );

describe("ProblemsList", () => {
  // ah-cp8 clamped this body to the window rather than to a fixed 50vh; ah-30hg.2 moved that clamp
  // up to the panel, which now holds four such bodies and must scroll once rather than four times.
  it("the list does not scroll on its own - the report panel is the one scroller", () => {
    const markup = renderToStaticMarkup(
      <ProblemsList
        hexes={[]}
        labelFor={(regionId) => regionId}
        onSelectHex={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(markup).not.toContain("overflow-y-auto");
    expect(markup).not.toContain("max-h-[calc(100vh-6rem)]");
  });
});

describe("ProblemsList, one card per hex (ah-uia)", () => {
  it("puts each hex in a bordered card with a brass header strip", () => {
    const markup = drawHexes();

    expect(markup.split("overflow-hidden rounded border border-edge bg-panel")).toHaveLength(3);
    expect(markup.split("bg-brass/10")).toHaveLength(3);
  });

  it("leads every problem with a severity glyph rather than colouring the message", () => {
    const markup = drawHexes();

    expect(markup).toContain("⚠");
    expect(markup).toContain("✕");
    expect(markup).toContain('text-ink">spends 250');
  });

  it("says hex where a hex-level problem has no unit id", () => {
    expect(drawHexes()).toContain(">hex<");
  });
});

describe("ProblemsList, a unit number is a way to go there (ah-87he)", () => {
  it("the unit id is a button when a handler is given", () => {
    const markup = renderToStaticMarkup(
      <ProblemsList
        hexes={HEXES}
        labelFor={(regionId) => regionId}
        onSelectHex={() => {}}
        onDismiss={() => {}}
        known={new Set(["3310"])}
        onSelectUnit={() => {}}
      />
    );

    expect(markup).toContain('data-testid="problem-unit-3310"');
    expect(markup).toContain("text-brass");
  });

  it("keeps the plain span when no handler is given", () => {
    expect(drawHexes()).not.toContain('data-testid="problem-unit-');
  });
});

// Decisions N2 and C1 (`ah-jw85`): a formed unit has no number in the report, so the panel names it
// by its alias rather than its synthetic id, and a click on it goes to the unit whose block wrote
// the FORM.
describe("ProblemsList, a formed unit's entry (ah-jw85)", () => {
  const FORMED_HEXES: HexFindings[] = [
    {
      regionId: "1:7,53",
      findings: [
        {
          code: "not-enough-silver",
          message: "spends 200 silver it has not got",
          lineStart: 3,
          lineEnd: 3,
          columnStart: 0,
          columnEnd: 4,
          regionId: "1:7,53",
          unitId: "new-1",
          formed: { alias: "1", formedBy: "1922" },
          severity: "warning"
        }
      ]
    }
  ];

  it("a_formed_unit_is_named_by_its_alias", () => {
    const markup = renderToStaticMarkup(
      <ProblemsList
        hexes={FORMED_HEXES}
        labelFor={(regionId) => regionId}
        onSelectHex={() => {}}
        onDismiss={() => {}}
      />
    );

    expect(markup).toContain(">new 1<");
    expect(markup).not.toContain(">new-1<");
  });

  it("clicking_a_formed_unit_selects_the_unit_that_forms_it", () => {
    const markup = renderToStaticMarkup(
      <ProblemsList
        hexes={FORMED_HEXES}
        labelFor={(regionId) => regionId}
        onSelectHex={() => {}}
        onDismiss={() => {}}
        known={new Set(["1922"])}
        onSelectUnit={() => {}}
      />
    );

    // Clickable only because "1922" - the forming unit, not "new-1" - is in `known`.
    expect(markup).toContain('data-testid="problem-unit-new-1"');
    expect(markup).toContain(">new 1<");
  });
});
