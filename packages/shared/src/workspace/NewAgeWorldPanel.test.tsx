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
        onSignOut={() => {}}
      />
    );
    const button = /<button[^>]*data-testid="newage-fetch-report"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(button).toContain("disabled");
    expect(markup).toContain("Fetching\u2026");
  });
});
