import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NewAgeWorldPanelBody } from "./NewAgeWorldPanel";

describe("the New Age world popover", () => {
  it("names who is signed in and offers to sign out", () => {
    const markup = renderToStaticMarkup(
      <NewAgeWorldPanelBody
        summary="Signed in to New Age: Arcanum as Merchant Guild (27)."
        fetching={false}
        onFetchReport={() => {}}
        historyBusy={false}
        onFetchEarlierTurns={() => {}}
        onSignOut={() => {}}
      />
    );
    expect(markup).toContain("Signed in to New Age: Arcanum as Merchant Guild (27).");
    expect(markup).toContain("Nothing is stored: closing Atlantis HUD signs you out.");
    expect(markup).toContain('data-testid="newage-signout"');
    expect(markup).toContain("Sign out");
  });

  it("offers to fetch this turn's report, above the note about signing out", () => {
    const markup = renderToStaticMarkup(
      <NewAgeWorldPanelBody
        summary="Signed in to New Age: Arcanum as Merchant Guild (27)."
        fetching={false}
        onFetchReport={() => {}}
        historyBusy={false}
        onFetchEarlierTurns={() => {}}
        onSignOut={() => {}}
      />
    );
    expect(markup).toContain('data-testid="newage-fetch-report"');
    // `renderToStaticMarkup` escapes the apostrophe, so the item is matched as it ships.
    expect(markup).toContain("Fetch this turn&#x27;s report");
    expect(markup.indexOf("newage-fetch-report")).toBeLessThan(
      markup.indexOf("Nothing is stored:")
    );
  });

  it("says it is fetching, and will not be asked twice", () => {
    const markup = renderToStaticMarkup(
      <NewAgeWorldPanelBody
        summary="Signed in to New Age: Arcanum as Merchant Guild (27)."
        fetching={true}
        onFetchReport={() => {}}
        historyBusy={false}
        onFetchEarlierTurns={() => {}}
        onSignOut={() => {}}
      />
    );
    const button = /<button[^>]*data-testid="newage-fetch-report"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(button).toContain("disabled");
    expect(markup).toContain("Fetching\u2026");
  });

  it("offers a second item for the world's earlier turns", () => {
    const markup = renderToStaticMarkup(
      <NewAgeWorldPanelBody
        summary="Signed in to New Age: Arcanum as Merchant Guild (27)."
        fetching={false}
        historyBusy={false}
        onFetchEarlierTurns={() => {}}
        onFetchReport={() => {}}
        onSignOut={() => {}}
      />
    );
    expect(markup).toContain('data-testid="newage-fetch-history"');
    expect(markup).toContain("Fetch earlier turns\u2026");
    expect(markup.indexOf("newage-fetch-report")).toBeLessThan(
      markup.indexOf("newage-fetch-history")
    );
    expect(markup.indexOf("newage-fetch-history")).toBeLessThan(
      markup.indexOf("Nothing is stored:")
    );
  });

  it("turns both items off while the turn dialog is busy", () => {
    const markup = renderToStaticMarkup(
      <NewAgeWorldPanelBody
        summary="Signed in to New Age: Arcanum as Merchant Guild (27)."
        fetching={false}
        historyBusy={true}
        onFetchEarlierTurns={() => {}}
        onFetchReport={() => {}}
        onSignOut={() => {}}
      />
    );
    for (const id of ["newage-fetch-report", "newage-fetch-history"]) {
      const button = new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`).exec(markup)?.[0] ?? "";
      expect(button).toContain("disabled");
    }
  });
});
