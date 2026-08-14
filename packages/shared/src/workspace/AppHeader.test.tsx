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
      onExportMap={() => {}}
      canExportMap={false}
      settingsOpen={false}
      onToggleSettings={() => {}}
      settings={null}
      {...overrides}
    />
  );

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
