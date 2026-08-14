import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { AppHeader } from "./AppHeader";
import { resetWorkspaceStore } from "../workspaceStore";

const draw = (overrides: Partial<Parameters<typeof AppHeader>[0]> = {}) =>
  renderToStaticMarkup(
    <AppHeader
      gameName="Game one"
      pickerOpen={false}
      onTogglePicker={() => {}}
      picker={null}
      factionLabel="Borg TNG (95)"
      turnLabel="71"
      mergedCount={0}
      mergedOpen={false}
      onToggleMerged={() => {}}
      mergedPanel={null}
      factionOpen={false}
      onFactionToggle={() => {}}
      factionPanel={null}
      status={null}
      messages={null}
      messagesOpen={false}
      onToggleMessages={() => {}}
      messagesPanel={null}
      problemCount={0}
      problemsOpen={false}
      onToggleProblems={() => {}}
      problemsPanel={null}
      battleCount={0}
      battlesOpen={false}
      onToggleBattles={() => {}}
      busy={false}
      onImportReports={() => {}}
      progress={null}
      onExportOrders={() => {}}
      canExport={false}
      onExportOrdersLong={() => {}}
      canExportLong={false}
      onExportMap={() => {}}
      canExportMap={false}
      settingsOpen={false}
      onToggleSettings={() => {}}
      settings={null}
      {...overrides}
    />
  );

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
    const closed = draw({ factionOpen: false });
    expect(closed).toContain('data-testid="faction-chip"');
    expect(closed).toContain('aria-expanded="false"');

    const open = draw({ factionOpen: true });
    expect(open).toContain('aria-expanded="true"');
  });

  it("there is no faction chip when no report is loaded", () => {
    const markup = draw({ factionLabel: null });
    expect(markup).not.toContain('data-testid="faction-chip"');
  });
});
