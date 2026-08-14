import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { DeclaredAttitudes, FactionStatus } from "@atlantis/core-client";
import { FactionPanel } from "./FactionPanel";
import { resetWorkspaceStore } from "../workspaceStore";

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

const draw = (overrides: Partial<Parameters<typeof FactionPanel>[0]> = {}) =>
  renderToStaticMarkup(
    <FactionPanel
      factionName="Borg TNG"
      factionId="95"
      factionTypes={["Magic 5"]}
      unclaimedSilver={6038}
      status={STATUS}
      attitudes={ATTITUDES}
      mergedFactionIds={new Set()}
      onDismiss={() => {}}
      {...overrides}
    />
  );

describe("FactionPanel", () => {
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
