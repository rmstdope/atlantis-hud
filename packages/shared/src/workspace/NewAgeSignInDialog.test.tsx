import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NewAgeSignInDialog } from "./NewAgeSignInDialog";
import { NEW_AGE_HOST, SIGN_IN_NOTE, type NewAgeSignInPhase } from "./newAgeSignInView";

const draw = (phase: NewAgeSignInPhase, suggestedFactionNumber: string | null = "27") =>
  renderToStaticMarkup(
    <NewAgeSignInDialog
      rulesetLabel="New Age: Arcanum"
      host={NEW_AGE_HOST}
      turnNumber={83}
      suggestedFactionNumber={suggestedFactionNumber}
      phase={phase}
      onSignIn={() => {}}
      onDismiss={() => {}}
    />
  );

/** The tag of the button with this test id, so `disabled` can be read off it. */
const buttonTag = (markup: string, testId: string) =>
  markup.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

describe("the New Age sign-in dialog", () => {
  it("names the world, the host and the turn, and cannot sign in with an empty password", () => {
    const markup = draw({ kind: "ready" });
    expect(markup).toContain("Sign in to New Age: Arcanum");
    expect(markup).toContain("atlantis-newage.com · turn 83");
    expect(markup).toContain("Faction number");
    expect(markup).toContain('placeholder="Required"');
    expect(markup).toContain(SIGN_IN_NOTE);
    expect(buttonTag(markup, "newage-signin-confirm")).toContain("disabled");
  });

  it("prefills the faction number it was given, and leaves it empty when given none", () => {
    expect(draw({ kind: "ready" })).toContain('data-testid="newage-faction-number"');
    expect(draw({ kind: "ready" })).toContain('value="27"');
    expect(draw({ kind: "ready" }, null)).not.toContain('value="27"');
  });

  it("quiets both fields while it is signing in", () => {
    const markup = draw({ kind: "signingIn" });
    const inputs = markup.match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input).toContain("disabled");
    }
    expect(buttonTag(markup, "newage-signin-confirm")).toContain("disabled");
  });

  it("shows a refusal, an unreachable world and a refused one, each in its own words", () => {
    expect(
      draw({
        kind: "failed",
        message: "The world did not accept that faction number and password.",
        retype: true
      })
    ).toContain("The world did not accept that faction number and password.");
    expect(
      draw({
        kind: "failed",
        message: "Could not reach atlantis-newage.com. Nothing was sent.",
        retype: false
      })
    ).toContain("Could not reach atlantis-newage.com. Nothing was sent.");
    expect(
      draw({ kind: "failed", message: "The world refused the sign-in (500).", retype: false })
    ).toContain("The world refused the sign-in (500).");
  });
});
