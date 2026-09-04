import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NewAgeWorldPanelBody } from "./NewAgeWorldPanel";

describe("the New Age world popover", () => {
  it("names who is signed in and offers to sign out", () => {
    const markup = renderToStaticMarkup(
      <NewAgeWorldPanelBody
        summary="Signed in to New Age: Arcanum as Merchant Guild (27)."
        onSignOut={() => {}}
      />
    );
    expect(markup).toContain("Signed in to New Age: Arcanum as Merchant Guild (27).");
    expect(markup).toContain("Nothing is stored: closing Atlantis HUD signs you out.");
    expect(markup).toContain('data-testid="newage-signout"');
    expect(markup).toContain("Sign out");
  });
});
