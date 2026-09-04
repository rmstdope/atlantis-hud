import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NewAgeSignInDialog } from "./NewAgeSignInDialog";
import { NewAgeSignInFields } from "./NewAgeSignInFields";
import { NEW_AGE_HOST, SIGN_IN_NOTE, type NewAgeSignInPhase } from "./newAgeSignInView";
import { FETCH_REAUTH_PURPOSE } from "./newAgeFetchView";

const draw = (
  phase: NewAgeSignInPhase,
  suggestedFactionNumber: string | null = "27",
  purpose?: typeof FETCH_REAUTH_PURPOSE
) =>
  renderToStaticMarkup(
    <NewAgeSignInDialog
      rulesetLabel="New Age: Arcanum"
      host={NEW_AGE_HOST}
      turnNumber={83}
      suggestedFactionNumber={suggestedFactionNumber}
      purpose={purpose}
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
    expect(markup).toContain('aria-label="Sign in to a New Age world"');
    expect(markup).toContain("Sign in");
    // Without a purpose the dialog carries no notice, so the default cannot quietly grow one.
    expect(markup).not.toContain("newage-signin-notice");
  });

  it("says why it came back, and offers to sign in and fetch", () => {
    const markup = draw({ kind: "ready" }, "27", FETCH_REAUTH_PURPOSE);
    expect(markup).toContain("Fetch this turn&#x27;s report");
    expect(markup).toContain('data-testid="newage-signin-notice"');
    expect(markup).toContain("Your session has ended. Sign in again to continue.");
    expect(markup).toContain("Sign in and fetch");
    expect(markup).toContain('aria-label="Sign in again to fetch a report"');
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

describe("the fields on their own", () => {
  const drawFields = (asksToSignIn?: boolean) =>
    renderToStaticMarkup(
      <NewAgeSignInFields
        asksToSignIn={asksToSignIn}
        factionNumber=""
        password=""
        phase={{ kind: "ready" }}
        onFactionNumber={() => {}}
        onPassword={() => {}}
      />
    );

  it("asks for a password alone when it is not asking for a sign-in", () => {
    const alone = drawFields(false);
    expect(alone).toContain("newage-password");
    expect(alone).not.toContain("newage-faction-number");
    expect(alone).not.toContain(SIGN_IN_NOTE);

    const both = drawFields();
    expect(both).toContain("newage-password");
    expect(both).toContain("newage-faction-number");
    expect(both).toContain(SIGN_IN_NOTE);
  });

  it("says nothing about a faction number it never asked for", () => {
    expect(
      renderToStaticMarkup(
        <NewAgeSignInFields
          asksToSignIn={false}
          factionNumber="not digits"
          password=""
          phase={{ kind: "ready" }}
          onFactionNumber={() => {}}
          onPassword={() => {}}
        />
      )
    ).not.toContain("newage-signin-problem");
  });
});
