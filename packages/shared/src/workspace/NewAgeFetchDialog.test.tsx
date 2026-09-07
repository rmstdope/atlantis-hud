import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NewAgeFetchDialog } from "./NewAgeFetchDialog";
import type { NewAgeFetchPhase } from "./newAgeFetchView";
import { NEW_AGE_HOST } from "./newAgeSignInView";

const draw = (phase: NewAgeFetchPhase) =>
  renderToStaticMarkup(
    <NewAgeFetchDialog
      rulesetLabel="New Age: Arcanum"
      worldName="Arcanum"
      host={NEW_AGE_HOST}
      turnNumber={83}
      suggestedFactionNumber="27"
      phase={phase}
      onFetch={() => {}}
      onDismiss={() => {}}
    />
  );

describe("NewAgeFetchDialog", () => {
  it("shows both fields and both choices while it is ready", () => {
    const markup = draw({ kind: "ready", message: null, retype: false });

    expect(markup).toContain("Fetch from New Age: Arcanum");
    expect(markup).toContain("atlantis-newage.com · turn 83");
    expect(markup).toContain('data-testid="newage-faction-number"');
    expect(markup).toContain('data-testid="newage-password"');
    expect(markup).toContain("Used for this fetch only. Nothing is written to this machine.");
    // `renderToStaticMarkup` escapes the apostrophe, so the tail of the sentence is what is read.
    expect(markup).toContain("report and every earlier turn not yet loaded");
    expect(markup).toContain('data-testid="newage-fetch-confirm"');
    expect(markup).not.toContain('data-testid="newage-fetch-working"');
  });

  it("says what the world refused, and keeps asking", () => {
    const markup = draw({
      kind: "ready",
      message: "The world did not accept that faction number and password.",
      retype: true
    });

    expect(markup).toContain("The world did not accept that faction number and password.");
    expect(markup).toContain('data-testid="newage-fetch-confirm"');
  });

  it("shows one line and one button while it works", () => {
    const markup = draw({ kind: "fetchingTurn", turnNumber: 80, done: 2, total: 9 });

    expect(markup).toContain("Fetching turn 80 from Arcanum — 3 of 9…");
    expect(markup).toContain('role="progressbar"');
    expect(markup).not.toContain('data-testid="newage-fetch-confirm"');
    expect(markup).not.toContain('data-testid="newage-password"');
    expect(markup).toContain('data-testid="newage-fetch-cancel"');
  });

  it("draws no progress bar for a step with nothing to divide", () => {
    const markup = draw({ kind: "signingIn" });

    expect(markup).toContain("Signing in…");
    expect(markup).not.toContain('role="progressbar"');
  });
});
