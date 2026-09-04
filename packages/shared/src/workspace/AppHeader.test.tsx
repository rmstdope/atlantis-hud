import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { SURFACE_LEVEL } from "../hexMapModel";
import { AppHeader } from "./AppHeader";
import { resetWorkspaceStore } from "../workspaceStore";
import { failedStatus, noticeStatus, routineStatus, warningStatus } from "./shellStatus";

const draw = (overrides: Partial<Parameters<typeof AppHeader>[0]> = {}) =>
  renderToStaticMarkup(
    <AppHeader
      gameName="Game one"
      levels={[SURFACE_LEVEL]}
      openPopover={null}
      onOpenPopover={() => {}}
      picker={null}
      factionLabel="Borg TNG (95)"
      turnLabel="71"
      workingTurnNumber="71"
      turnPicker={null}
      comparedTurnLabel={null}
      onStopComparing={() => {}}
      mergedCount={0}
      mergedPanel={null}
      mageSheetChip={null}
      mageSheetsPanel={null}
      factionPanel={null}
      status={null}
      counts={null}
      reportPanel={null}
      tradeCount={0}
      tradePanel={null}
      battleCount={0}
      battlesOpen={false}
      onToggleBattles={() => {}}
      changesOpen={false}
      onToggleChanges={() => {}}
      busy={false}
      onImportReports={() => {}}
      progress={null}
      onExportOrders={() => {}}
      canExport={false}
      onExportOrdersLong={() => {}}
      canExportLong={false}
      onExportMap={() => {}}
      canExportMap={false}
      onExportMageSheet={() => {}}
      canExportMageSheet={false}
      settingsOpen={false}
      onToggleSettings={() => {}}
      settings={null}
      {...overrides}
    />
  );

/** The turn chip's own text, tags stripped and whitespace collapsed. */
const turnChipText = (markup: string) => {
  const m = markup.match(/<button[^>]*data-testid="turn-chip"[^>]*>([\s\S]*?)<\/button>/);
  expect(m).not.toBeNull();
  return m![1]
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

describe("AppHeader the game-state strip", () => {
  beforeEach(resetWorkspaceStore);

  it("the turn chip carries the word Turn", () => {
    expect(turnChipText(draw())).toContain("Turn 71");
  });

  it("the turn chip still says which turns are being compared", () => {
    const text = turnChipText(draw({ comparedTurnLabel: "70" }));
    expect(text).toContain("Turn 71");
    expect(text).toContain("\u21c4");
    expect(text).toContain("70");
  });

  it("the faction chip is bordered like the game and turn chips", () => {
    const cls = draw().match(
      /<button[^>]*data-testid="faction-chip"[^>]*class="([^"]*)"/
    )![1];
    expect(cls).toContain("border-edge");
    expect(cls).toContain("bg-panel-raised");
  });

  it("the header strip does not repeat the application's name", () => {
    expect(draw()).not.toContain("ATLANTIS HUD");
  });
});

describe("AppHeader wrapping", () => {
  beforeEach(resetWorkspaceStore);

  it("the header wraps and keeps the actions grouped right", () => {
    const markup = draw();
    const rootMatch = markup.match(/<header[^>]*class="([^"]*)"/);
    expect(rootMatch).not.toBeNull();
    const rootClass = rootMatch![1];
    expect(rootClass).toContain("flex-wrap");
    expect(rootClass).toContain("min-h-9");
    expect(rootClass.split(/\s+/)).not.toContain("h-9");

    const actionsMatch = markup.match(/<[^>]*data-testid="header-actions"[^>]*class="([^"]*)"/);
    expect(actionsMatch).not.toBeNull();
    expect(actionsMatch![1]).toContain("ml-auto");

    const actionsIndex = markup.indexOf('data-testid="header-actions"');
    const exportIndex = markup.indexOf('data-testid="export-menu"');
    expect(exportIndex).toBeGreaterThan(actionsIndex);
  });
});

describe("AppHeader faction chip", () => {
  beforeEach(resetWorkspaceStore);

  it("the faction name is a button that says whether the panel is open", () => {
    const closed = draw();
    expect(closed).toContain('data-testid="faction-chip"');
    expect(closed).toContain('aria-expanded="false"');

    const open = draw({ openPopover: "faction" });
    expect(open).toContain('aria-expanded="true"');
  });

  it("there is no faction chip when no report is loaded", () => {
    const markup = draw({ factionLabel: null });
    expect(markup).not.toContain('data-testid="faction-chip"');
  });
});

describe("AppHeader turn chip", () => {
  beforeEach(resetWorkspaceStore);

  it("the turn chip shows the comparison and offers the way out", () => {
    const comparing = draw({ comparedTurnLabel: "70" });
    expect(comparing).toContain('data-testid="turn-chip"');
    expect(comparing).toContain("⇄");
    expect(comparing).toContain("70");
    expect(comparing).toContain('aria-label="stop comparing"');

    const notComparing = draw({ comparedTurnLabel: null });
    expect(notComparing).not.toContain("⇄");
    expect(notComparing).not.toContain('aria-label="stop comparing"');
    expect(notComparing).toContain("▾");
  });

  it("the turn chip is a button that says whether the picker is open", () => {
    const closed = draw();
    expect(closed).toContain('data-testid="turn-chip"');
    expect(closed).toContain('aria-expanded="false"');

    const open = draw({ openPopover: "turns" });
    expect(open).toContain('aria-expanded="true"');
  });
});

describe("AppHeader popovers", () => {
  beforeEach(resetWorkspaceStore);

  it("at most one popover renders, the open one", () => {
    const markup = draw({
      openPopover: "faction",
      factionPanel: <div data-testid="p-faction" />,
      mergedCount: 1,
      mergedPanel: <div data-testid="p-merged" />
    });

    expect(markup).toContain("p-faction");
    expect(markup).not.toContain("p-merged");
  });

  it("the export menu is a header popover too", () => {
    const open = draw({ openPopover: "export" });
    expect(open).toContain('data-testid="export-menu-panel"');

    const closed = draw();
    expect(closed).not.toContain('data-testid="export-menu-panel"');
  });
});

describe("AppHeader trade chip", () => {
  beforeEach(resetWorkspaceStore);

  // Copilot review on #358: matching the chip's classes anywhere in the markup can pass even when
  // the Trade chip itself is not dimmed, since `border-edge`/`text-ink-dim` also occur elsewhere in
  // the header - so the button's own `class` attribute is extracted and asserted against directly.
  const tradeChipClass = (markup: string) => {
    const match = markup.match(/<button[^>]*data-testid="trade-chip"[^>]*class="([^"]*)"/);
    expect(match).not.toBeNull();
    return match![1];
  };

  it("the trade chip is shown even when there is nothing to trade", () => {
    const markup = draw({ tradeCount: 0 });
    expect(markup).toContain('data-testid="trade-chip"');
    expect(markup).toContain("Trade 0");
    const chipClass = tradeChipClass(markup);
    expect(chipClass).toContain("border-edge");
    expect(chipClass).toContain("text-ink-dim");
  });

  it("it reads the count and turns gain-coloured once there is something to trade", () => {
    const markup = draw({ tradeCount: 6 });
    expect(markup).toContain("Trade 6");
    const chipClass = tradeChipClass(markup);
    expect(chipClass).toContain("border-gain");
    expect(chipClass).toContain("text-gain");
  });

  it("says whether the popover is open", () => {
    const closed = draw();
    expect(closed).toContain('data-testid="trade-chip"');
    expect(closed).toContain('aria-expanded="false"');

    const open = draw({ openPopover: "trade" });
    expect(open).toContain('aria-expanded="true"');
  });
});

describe("AppHeader changes chip", () => {
  beforeEach(resetWorkspaceStore);

  it("the changes chip appears with a comparison and not without", () => {
    const comparing = draw({ comparedTurnLabel: "70" });
    expect(comparing).toContain('data-testid="changes-chip"');

    const notComparing = draw({ comparedTurnLabel: null });
    expect(notComparing).not.toContain('data-testid="changes-chip"');
  });

  it("the changes chip says whether the dialog is open", () => {
    const closed = draw({ comparedTurnLabel: "70", changesOpen: false });
    expect(closed).toContain('data-testid="changes-chip"');
    expect(closed).toContain('aria-expanded="false"');

    const open = draw({ comparedTurnLabel: "70", changesOpen: true });
    expect(open).toContain('aria-expanded="true"');
  });
});

describe("AppHeader status line", () => {
  beforeEach(resetWorkspaceStore);

  it("a routine status is written but takes no room", () => {
    const markup = draw({ status: routineStatus("11 regions · 42 units") });
    const statusMatch = markup.match(/<span[^>]*data-testid="import-status"[^>]*>.*?<\/span>/s);
    expect(statusMatch).not.toBeNull();
    const statusMarkup = statusMatch![0];
    expect(statusMarkup).toContain("sr-only");
    expect(statusMarkup).toContain("11 regions · 42 units");
    expect(statusMarkup).not.toContain("rounded-full");
  });

  it("a notice is visible with a dim dot", () => {
    const markup = draw({ status: noticeStatus("orders imported: 3 units") });
    const statusMatch = markup.match(/<span[^>]*data-testid="import-status"[^>]*class="([^"]*)"/);
    expect(statusMatch).not.toBeNull();
    expect(statusMatch![1]).not.toContain("sr-only");
    expect(markup).toContain("bg-ink-dim");
  });

  it("a warning is visible with an amber dot", () => {
    const markup = draw({ status: warningStatus("the turn could not be remembered: disk is full") });
    expect(markup).toContain("bg-warn");
  });

  it("a failure is visible with a red dot and leaves the report chip in place", () => {
    const markup = draw({
      status: failedStatus("could not read x.rep: no faction header"),
      counts: { problems: 0, engine: 1, unreadable: 0, events: 0 }
    });
    expect(markup).toContain("bg-danger");
    expect(markup).toContain('data-testid="turn-report-chip"');
  });

  it("no status says no report loaded", () => {
    const markup = draw();
    expect(markup).toContain("no report loaded");
    expect(markup).toContain("sr-only");
  });
});

describe("AppHeader Send button", () => {
  beforeEach(resetWorkspaceStore);

  it("shows no Send button when the shell cannot send", () => {
    expect(draw()).not.toContain('data-testid="send-orders"');
  });

  it("shows a Send button when the shell can", () => {
    const markup = draw({ onSendOrders: () => {}, canSend: true });
    expect(markup).toContain('data-testid="send-orders"');

    // Immediately right of the export popover, and before the settings cog.
    const exportIndex = markup.indexOf('data-testid="export-menu"');
    const sendIndex = markup.indexOf('data-testid="send-orders"');
    const settingsIndex = markup.indexOf('data-testid="settings-indicator"');
    expect(sendIndex).toBeGreaterThan(exportIndex);
    expect(settingsIndex).toBeGreaterThan(sendIndex);
  });

  it("disables Send and gives the reason when the orders carry no faction", () => {
    const reason =
      "These orders have no #atlantis line, so the server cannot tell which faction they belong to.";
    const markup = draw({ onSendOrders: () => {}, canSend: false, sendDisabledReason: reason });
    const button = markup.match(/<button[^>]*data-testid="send-orders"[^>]*>/)![0];
    expect(button).toContain("disabled");
    expect(button).toContain(`title="${reason}"`);
  });
});

describe("AppHeader map level", () => {
  beforeEach(resetWorkspaceStore);

  it("names each level with the core's word, as a select when there is a choice", () => {
    // Moved up from the strip over the map (ah-l9mp): the level is changed often and wants to be
    // seen at a glance, beside the faction name.
    const markup = draw({
      levels: [
        { z: 0, name: "nexus" },
        { z: 1, name: "surface" }
      ]
    });

    expect(markup).toContain('aria-label="Map level"');
    expect(markup).toContain(">nexus<");
    expect(markup).toContain(">surface<");
    expect(markup.indexOf(">nexus<")).toBeLessThan(markup.indexOf(">surface<"));
  });

  it("shows the single level as static text, not a control", () => {
    const markup = draw({ levels: [{ z: 0, name: "nexus" }] });

    expect(markup).toContain("nexus");
    expect(markup).not.toContain('aria-label="Map level"');
  });

  it("falls back to the surface word when there are no levels at all", () => {
    expect(draw({ levels: [] })).toContain("surface");
  });
});

// ah-30hg.2: three amber chips - what the engine reported, what order validation found and what the
// parser could not read - stood side by side and cost the header a row. They are one.
describe("AppHeader, one chip for everything the turn wants checked (ah-30hg.2)", () => {
  it("folds the three advisory chips into one", () => {
    const markup = draw({ counts: { problems: 10, engine: 1, unreadable: 6, events: 333 } });
    expect(markup).toContain('data-testid="turn-report-chip"');
    expect(markup).toContain("17 to check");
    for (const gone of ["turn-messages-chip", "problems-chip", "unreadable-chip"]) {
      expect(markup).not.toContain(`data-testid="${gone}"`);
    }
  });

  it("carries each source's own count, so a test can wait on the one it means", () => {
    const markup = draw({ counts: { problems: 10, engine: 1, unreadable: 6, events: 333 } });
    expect(markup).toContain('data-problems="10"');
    expect(markup).toContain('data-errors="1"');
    expect(markup).toContain('data-unreadable="6"');
    expect(markup).toContain('data-events="333"');
  });

  it("is not amber when the turn only has events to report", () => {
    const markup = draw({ counts: { problems: 0, engine: 0, unreadable: 0, events: 333 } });
    expect(markup).toContain("Turn report");
    expect(markup).not.toContain("border-warn");
  });

  it("has no chip at all until a report is loaded", () => {
    expect(draw({ counts: null })).not.toContain('data-testid="turn-report-chip"');
  });
});

describe("AppHeader mage-sheet chip", () => {
  beforeEach(resetWorkspaceStore);

  it("counts the sheets, and how many are behind the turn", () => {
    expect(draw()).not.toContain('data-testid="mage-sheets-chip"');

    const plain = draw({ mageSheetChip: { text: "2 mage sheets", stale: false } });
    expect(plain).toContain('data-testid="mage-sheets-chip"');
    expect(plain).toContain("2 mage sheets");
    expect(plain).not.toContain("border-danger");

    const stale = draw({ mageSheetChip: { text: "2 mage sheets \u00b7 1 old", stale: true } });
    expect(stale).toContain("border-danger");
    expect(stale).toContain("text-danger");
  });

  it("its panel renders only while it is the open popover", () => {
    const shut = draw({
      openPopover: "faction",
      mageSheetChip: { text: "1 mage sheet", stale: false },
      mageSheetsPanel: <div data-testid="p-mage-sheets" />
    });
    expect(shut).not.toContain("p-mage-sheets");

    const open = draw({
      openPopover: "mageSheets",
      mageSheetChip: { text: "1 mage sheet", stale: false },
      mageSheetsPanel: <div data-testid="p-mage-sheets" />
    });
    expect(open).toContain("p-mage-sheets");
  });
});
