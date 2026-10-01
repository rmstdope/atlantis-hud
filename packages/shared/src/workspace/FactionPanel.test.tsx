import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  aProductionOverview,
  type DeclaredAttitudes,
  type FactionStatus,
  type UnclaimedSilverUse
} from "@atlantis/core-client";
import { NO_FACTION_ORDERS, NO_STUDENTS } from "../orderEditor";
import { FactionPanel } from "./FactionPanel";
import {
  UnclaimedSilverUseBreakdown,
  UnclaimedSilverUseTrigger
} from "./UnclaimedSilverUseDetails";
import { resetWorkspaceStore } from "../workspaceStore";
import { findByTestId } from "../testing/elementTree";

const STATUS: FactionStatus = {
  entries: [
    { label: "Regions", used: 0, maximum: 0 },
    { label: "Mages", used: 6, maximum: 6 },
    { label: "Apprentices", used: 15, maximum: 15 }
  ],
  unparsed: []
};

const ATTITUDES: DeclaredAttitudes = {
  defaultAttitude: "Unfriendly",
  levels: [
    { attitude: "Hostile", factions: [{ name: "Creatures", id: "2" }] },
    { attitude: "Unfriendly", factions: [] },
    { attitude: "Neutral", factions: [{ name: "Fon", id: "8" }] }
  ]
};

const SILVER_USE: UnclaimedSilverUse = {
  claims: {
    amount: 800,
    entries: [
      { unitName: "Mercers", unitId: "14", amount: 500, detail: null },
      { unitName: "Scouts", unitId: "22", amount: 300, detail: null }
    ]
  },
  withdrawals: {
    amount: 400,
    entries: [{ unitName: "Smiths", unitId: "31", amount: 400, detail: "10 iron" }]
  },
  maintenance: {
    amount: 150,
    entries: [
      { unitName: "Farmers", unitId: "40", amount: 60, detail: null },
      { unitName: "Guards", unitId: "41", amount: 40, detail: null },
      { unitName: "Ferrymen", unitId: "43", amount: 50, detail: null },
      { unitName: "Watch", unitId: "44", amount: 20, detail: null }
    ]
  },
  used: 1350,
  remaining: 2860,
  notCounted: [
    { unitName: "Smiths", unitId: "31", order: "100 iron", amount: 400, reason: "insufficient-funds" },
    { unitName: "Envoys", unitId: "9", order: "1 sword", amount: 100, reason: "not-basic-item" },
    { unitName: "Builders", unitId: "5", order: "20 stone", amount: 20, reason: "nexus" }
  ]
};

const tree = (overrides: Partial<Parameters<typeof FactionPanel>[0]> = {}) => (
  <FactionPanel
    factionName="Borg TNG"
    factionId="95"
    factionTypes={["Magic 5"]}
    unclaimedSilver={6038}
    unclaimedSilverUse={null}
    status={STATUS}
    attitudes={ATTITUDES}
    mergedFactionIds={new Set()}
    production={aProductionOverview()}
    students={NO_STUDENTS}
    faction={NO_FACTION_ORDERS}
    onDismiss={() => {}}
    {...overrides}
  />
);

const draw = (overrides: Partial<Parameters<typeof FactionPanel>[0]> = {}) =>
  renderToStaticMarkup(tree(overrides));

describe("FactionPanel", () => {
  it("shows the report's split and the applied one with an arrow (ah-7g4f)", () => {
    const html = draw({
      factionTypes: ["Martial 1", "Magic 1"],
      faction: {
        applied: {
          split: { martial: 3, magic: 2 },
          limits: { regions: 40, quartermasters: 9, mages: 3, apprentices: 5 }
        },
        lastFailure: null
      }
    });
    expect(html).toContain("Martial 1, Magic 1");
    expect(html).toContain("→");
    expect(html).toContain("Martial 3, Magic 2");
  });

  it("shows no arrow without an applied split (ah-7g4f)", () => {
    expect(draw()).not.toContain("→");
  });

  it("shows the failing FACTION order line (ah-7g4f)", () => {
    const html = draw({
      faction: {
        applied: null,
        lastFailure: {
          points: { split: { martial: 4, magic: 3 }, total: 7, available: 5 },
          minimums: [],
          limits: []
        }
      }
    });
    expect(html).toContain('data-testid="faction-order-warning"');
    expect(html).toContain("FACTION order will fail — 7 points, the faction has 5");
  });

  it("offers Production… under the allowances when it can open it", () => {
    const html = draw({ onOpenProduction: () => {} });
    expect(html).toContain('data-testid="faction-production"');
    expect(html).toContain("Production…");
  });

  it("offers no Production button without a way to open it", () => {
    expect(draw()).not.toContain("faction-production");
  });

  beforeEach(resetWorkspaceStore);

  it("shows the faction name, id and types", () => {
    const markup = draw();
    expect(markup).toContain("Borg TNG");
    expect(markup).toContain("95");
    expect(markup).toContain("Magic 5");
  });

  it("shows the unclaimed silver", () => {
    const markup = draw();
    expect(markup).toContain("6038");
  });

  it("shows expected use and the breakdown for this turn", () => {
    const markup = draw({ unclaimedSilverUse: SILVER_USE });
    const breakdown = renderToStaticMarkup(<UnclaimedSilverUseBreakdown usage={SILVER_USE} />);
    expect(markup).toContain("Expected use this turn");
    expect(markup).toContain("1350");
    expect(markup).toContain("2860 left");
    expect(markup).toContain('aria-expanded="false"');
    expect(breakdown).toContain("From unclaimed silver this turn");
    expect(breakdown).toContain("CLAIM");
    expect(breakdown).toContain("WITHDRAW");
    expect(breakdown).toContain("Maintenance");
    expect(breakdown).toContain("10 iron");
    expect(breakdown).toContain("not enough unclaimed silver");
    expect(breakdown).toContain("not a basic item");
    expect(breakdown).toContain("no WITHDRAW in the Nexus");
    expect(breakdown).toContain("+ 1 more unit");
  });

  it("shows none when the fund is untouched and omits the breakdown trigger", () => {
    const markup = draw({
      unclaimedSilverUse: {
        claims: { amount: 0, entries: [] },
        withdrawals: { amount: 0, entries: [] },
        maintenance: { amount: 0, entries: [] },
        used: 0,
        remaining: 6038,
        notCounted: []
      }
    });
    expect(markup).toContain("Expected use this turn");
    expect(markup).toContain("none");
    expect(markup).not.toContain('data-testid="unclaimed-silver-use-trigger"');
  });

  it("keeps rejected withdrawals inspectable when none of them were accepted", () => {
    const markup = draw({
      unclaimedSilverUse: {
        ...SILVER_USE,
        claims: { amount: 0, entries: [] },
        withdrawals: { amount: 0, entries: [] },
        maintenance: { amount: 0, entries: [] },
        used: 0,
        remaining: 6038
      }
    });
    expect(markup).toContain("Expected use this turn");
    expect(markup).toContain("none");
    expect(markup).toContain('data-testid="unclaimed-silver-use-trigger"');
    expect(renderToStaticMarkup(<UnclaimedSilverUseBreakdown usage={SILVER_USE} />)).toContain(
      "not a basic item"
    );
  });

  it("opens on focus and Escape hides the breakdown without closing the faction view", () => {
    const points: { x: number; y: number }[] = [];
    let dismissed = false;
    const details = findByTestId(
      <UnclaimedSilverUseTrigger
        usage={SILVER_USE}
        open
        onOpen={(point) => points.push(point)}
        onClose={() => {
          dismissed = true;
        }}
      />,
      "unclaimed-silver-use-trigger"
    );
    const focusTarget = {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 40, height: 20 })
    };
    (details.props.onFocus as (event: { currentTarget: typeof focusTarget }) => void)({
      currentTarget: focusTarget
    });
    expect(points).toEqual([{ x: 30, y: 30 }]);

    const escapeEvent = {
      key: "Escape",
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      }
    };
    (details.props.onKeyDown as (event: typeof escapeEvent) => void)(escapeEvent);
    expect(dismissed).toBe(true);
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(escapeEvent.propagationStopped).toBe(true);
  });

  it("shows each allowance as used of maximum", () => {
    const markup = draw();
    expect(markup).toContain("0 / 0");
    expect(markup).toContain("6 / 6");
    expect(markup).toContain("15 / 15");
  });

  it("shows each attitude level with its factions", () => {
    const markup = draw();
    expect(markup).toContain("Hostile");
    expect(markup).toContain("Creatures (2)");
    expect(markup).toContain("Neutral");
    expect(markup).toContain("Fon (8)");
  });

  it("states the default attitude", () => {
    const markup = draw();
    expect(markup).toContain("default Unfriendly");
  });

  it("the body is clamped to the window, not to 40vh", () => {
    const markup = draw();
    expect(markup).toContain("max-h-[calc(100vh-6rem)]");
    expect(markup).not.toContain("max-h-[40vh]");
  });

  describe("degrading", () => {
    it("a report with neither block still renders the name and the silver", () => {
      const markup = draw({ status: null, attitudes: null });
      expect(markup).toContain("Borg TNG");
      expect(markup).toContain("6038");
    });

    it("a report with no unclaimed silver omits that row rather than showing null", () => {
      const markup = draw({ unclaimedSilver: null });
      expect(markup).not.toContain("null");
      expect(markup).not.toContain("Unclaimed silver");
    });

    it("an empty allowance list omits the whole Allowances section, heading included", () => {
      const markup = draw({ status: { entries: [], unparsed: [] } });
      expect(markup).not.toContain("Allowances");
    });

    it("an empty attitude list omits the whole attitudes section", () => {
      const markup = draw({ attitudes: { defaultAttitude: "Unfriendly", levels: [] } });
      expect(markup).not.toContain("Declared attitudes");
    });
  });

  describe("unparsed status lines", () => {
    it("a status line the parser did not understand is shown verbatim below the allowances", () => {
      const markup = draw({
        status: { entries: STATUS.entries, unparsed: ["Something odd: 3"] }
      });
      expect(markup).toContain("Something odd: 3");
    });

    it("no such lines means no footnote at all", () => {
      const markup = draw();
      // Nothing beyond the allowances/attitudes content should render a dangling border-t footer.
      expect(markup).not.toContain("Something odd");
    });
  });
});

describe("an attitude name as a way into the faction dossier (ah-bu2c)", () => {
  it("renders every attitude name through renderFactionName", () => {
    const markup = draw({
      renderFactionName: (factionId: string, label: React.ReactNode) => (
        <button type="button" data-testid={`open-dossier-${factionId}`}>
          {label}
        </button>
      )
    });

    expect(markup).toContain('data-testid="open-dossier-2"');
    expect(markup).toContain('data-testid="open-dossier-8"');
    expect(markup).toContain("Creatures (2)");
  });

  it("prints the names plainly when nothing offers a dossier", () => {
    const markup = draw();
    expect(markup).toContain("Creatures (2)");
    expect(markup).not.toContain("open-dossier");
  });
});

describe("allowances counted from this turn's orders (ah-x7s3)", () => {
  it("a row over its limit is red with its note", () => {
    const markup = draw({
      status: { entries: [{ label: "Mages", used: 5, maximum: 5 }], unparsed: [] },
      students: { ...NO_STUDENTS, mages: 1 }
    });
    expect(markup).toContain("bg-danger");
    expect(markup).toContain("text-danger");
    expect(markup).toContain("6 / 5");
    expect(markup).toContain('data-testid="allowance-note"');
    expect(markup).toContain("1 over — 1 unit");
  });

  it("a row at its limit is brass, with no note", () => {
    const markup = draw({ status: { entries: [{ label: "Mages", used: 5, maximum: 5 }], unparsed: [] } });
    expect(markup).toContain("bg-brass");
    expect(markup).not.toContain("allowance-note");
  });

  it("Regions reads this turn's count", () => {
    const markup = draw({ status: { entries: [{ label: "Regions", used: 4, maximum: 10 }], unparsed: [] } });
    expect(markup).toContain("0 / 10");
    expect(markup).not.toContain("4 / 10");
  });
});
