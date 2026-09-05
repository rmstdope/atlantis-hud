import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { aParsedReport, aReportHeaderInfo, aReportUnit } from "@atlantis/core-client";
import type { AlliedMageRecord, SkillInfo, StudyPlanRecord } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "../gameData";
import { buildMagicTree } from "../magicTree";
import { standingOf } from "../magicStanding";
import { plannerGroups, type PlannerMage } from "../studyPlanner";
import { StudyPlannerDetail, StudyPlannerList, StudyPlannerDialog } from "./StudyPlannerDialog";

const index = parseGameData(readRuleset()) as GameDataIndex;
const tree = buildMagicTree(index);

const held = (levels: Record<string, [number, number]>): SkillInfo[] =>
  Object.entries(levels).map(([tag, [level, points]]) => ({
    name: tag.toLowerCase(),
    tag,
    level,
    points
  }));

const ally: AlliedMageRecord = {
  factionId: "17",
  factionName: "Creeping Death",
  unit: aReportUnit({
    unitId: "300",
    name: "Ghost",
    own: false,
    factionId: "17",
    skills: held({ SPIR: [3, 270] })
  }),
  sheetTurn: 69,
  receivedAt: "2026-01-01T00:00:00Z"
};

const GROUPS = plannerGroups({
  report: aParsedReport({
    header: aReportHeaderInfo({ factionId: "95", factionName: "Borg TNG", turnNumber: 71 })
  }),
  ownMages: [
    standingOf(
      aReportUnit({ unitId: "881", name: "Six of Seven", skills: held({ FORC: [4, 325], SPIR: [1, 30] }) }),
      tree,
      index
    ),
    standingOf(
      aReportUnit({ unitId: "882", name: "One of Nine", skills: held({ MANI: [3, 180] }) }),
      tree,
      index
    ),
    // Fire sits behind force, so a mage holding both at 1 has fire at its ceiling.
    standingOf(
      aReportUnit({ unitId: "883", name: "Two of Ten", skills: held({ FORC: [1, 30], FIRE: [1, 30] }) }),
      tree,
      index
    )
  ],
  alliedMages: [ally],
  tree,
  index,
  viewedTurn: 71
});

const mageBy = (unitId: string): PlannerMage => {
  const mage = GROUPS.flatMap((group) => group.mages).find((row) => row.unitId === unitId);
  if (mage === undefined) {
    throw new Error(`no mage ${unitId}`);
  }
  return mage;
};

const label = (regionId: string) => `plains (${regionId})`;

describe("StudyPlannerList", () => {
  const markup = renderToStaticMarkup(
    <StudyPlannerList groups={GROUPS} picked={mageBy("881")} onPick={() => {}} onMove={() => false} />
  );

  it("carries one option per mage and a heading per group", () => {
    expect(markup.match(/role="option"/g)).toHaveLength(4);
    expect(markup).toContain("Borg TNG (95) — your faction, turn 71");
    expect(markup).toContain("Creeping Death (17) — turn 69 · 2 turns old");
  });

  it("selects exactly the picked mage", () => {
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-selected="false"/g)).toHaveLength(3);
    // Keyed on faction and unit together, so a report and an allied sheet carrying the same
    // unit number cannot address one another's row.
    expect(markup).toContain('data-testid="study-planner-mage-95/881"');
    expect(markup).toContain('data-testid="study-planner-mage-17/300"');
  });

  it("keeps the selection visible inside a stale group", () => {
    const staleSelected = renderToStaticMarkup(
      <StudyPlannerList groups={GROUPS} picked={mageBy("300")} onPick={() => {}} onMove={() => false} />
    );
    // The stale tint is on unselected rows only, so it cannot swallow the selected row's own.
    expect(staleSelected).toContain("border-select bg-panel text-ink");
    expect(staleSelected.match(/border-select/g)).toHaveLength(1);
  });

  it("gives each row its summary", () => {
    expect(markup).toContain("Six of Seven");
    expect(markup).toContain("can study");
  });
});

describe("StudyPlannerDetail", () => {
  const own = renderToStaticMarkup(<StudyPlannerDetail
        mage={mageBy("881")}
        label={label}
        tree={tree}
        plan={null}
        saveError={null}
        onSaveNote={() => {}}
      />);
  const stale = renderToStaticMarkup(<StudyPlannerDetail
        mage={mageBy("300")}
        label={label}
        tree={tree}
        plan={null}
        saveError={null}
        onSaveNote={() => {}}
      />);

  it("says how old a stale mage's news is and marks what it estimated", () => {
    expect(stale).toContain(
      "From a mage sheet of turn 69, 2 turns old. Up to 2 months of study since it are estimated below and marked →."
    );
    expect(stale).toContain("spirit 3 → up to 4");
  });

  it("says neither about one of your own", () => {
    expect(own).not.toContain("mage sheet of turn");
    expect(own).not.toContain("up to");
    expect(own).toContain("from this turn&#x27;s report");
  });

  it("counts what he may study now", () => {
    expect(own).toContain(`Can study now — ${mageBy("881").canStudy.length}`);
  });

  it("keeps the held-back section even when nothing is", () => {
    expect(own).toContain("Held back");
    expect(own).toContain("Nothing he holds is at a prerequisite&#x27;s ceiling.");
  });

  it("names what holds a skill back in the tree's own words", () => {
    const heldBack = renderToStaticMarkup(<StudyPlannerDetail
        mage={mageBy("883")}
        label={label}
        tree={tree}
        plan={null}
        saveError={null}
        onSaveNote={() => {}}
      />);
    expect(heldBack).toContain("fire — at 1, held by force");
    expect(heldBack).not.toContain("Nothing he holds is at a prerequisite");
  });
});

/**
 * K1: the warnings strip belongs to the Schedule view alone. The All mages view is not given a
 * strip it never had, and neither of its two components renders one.
 */
describe("the All mages view carries no warnings strip", () => {
  it("shows neither the toggle nor the empty line", () => {
    const list = renderToStaticMarkup(
      <StudyPlannerList groups={GROUPS} picked={mageBy("881")} onPick={() => {}} onMove={() => false} />
    );
    const detail = renderToStaticMarkup(
      <StudyPlannerDetail
        mage={mageBy("881")}
        label={label}
        tree={tree}
        plan={null}
        saveError={null}
        onSaveNote={() => {}}
      />
    );

    for (const markup of [list, detail]) {
      expect(markup).not.toContain("study-planner-warnings");
    }
  });
});

/**
 * The Orders tab (`ah-lyg6.4.1`). Rendered with `renderToStaticMarkup`, which runs no effects and
 * fires no timers - so this pins what the pane opens on and what its header offers, and the smoke
 * suite proves the switch.
 */
describe("the Orders tab", () => {
  const dialog = (plans: StudyPlanRecord[]) =>
    renderToStaticMarkup(
      <StudyPlannerDialog
        groups={GROUPS}
        summaryLine={null}
        emptyCopy={{ headline: "", detail: "" }}
        alliedStatus="ready"
        selectedUnitId={null}
        label={label}
        seats={new Map()}
        structureNames={new Map()}
        tree={tree}
        plans={plans}
        viewedTurn={71}
        saveError={null}
        onSaveText={() => {}}
        ordersError={null}
        onSavePlan={() => {}}
        onSaveNote={() => {}}
        onDismiss={() => {}}
      />
    );

  it("the_orders_tab_is_the_third_tab", () => {
    const markup = dialog([]);
    expect(markup).toContain('data-testid="study-planner-view-orders"');
    expect(markup.indexOf("study-planner-view-schedule")).toBeLessThan(
      markup.indexOf("study-planner-view-orders")
    );
    // The pane never opens on it: the view switch is remembered no longer than the dialog.
    expect(markup).toContain('data-testid="study-planner-view-orders" aria-selected="false"');
    expect(markup).not.toContain('data-testid="study-planner-orders"');
  });

  it("save_all_is_offered_only_on_the_orders_tab_and_only_with_sections", () => {
    expect(dialog([])).not.toContain('data-testid="study-planner-save-all"');
  });
});
