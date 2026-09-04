import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { NewAgeOrderVerdict } from "./newAgeApi";
import { NewAgeSendDialog } from "./NewAgeSendDialog";
import { NEW_AGE_HOST, SESSION_ENDED, SIGN_IN_NOTE } from "./newAgeSignInView";
import type { NewAgeSendPhase } from "./newAgeSendView";

const draw = (
  phase: NewAgeSendPhase,
  { asksSignIn = false, turnNumber = 84 as number | null } = {}
) =>
  renderToStaticMarkup(
    <NewAgeSendDialog
      worldName="Arcanum"
      factionLabel="Merchant Guild (27)"
      turnNumber={turnNumber}
      host={NEW_AGE_HOST}
      asksSignIn={asksSignIn}
      suggestedFactionNumber="27"
      phase={phase}
      onSend={() => {}}
      onDismiss={() => {}}
    />
  );

function verdictPhase(overrides: Partial<NewAgeOrderVerdict> = {}): NewAgeSendPhase {
  return {
    kind: "verdict",
    verdict: {
      saved: true,
      valid: true,
      errorCount: 0,
      errors: [],
      warnings: [],
      message: "",
      ...overrides
    }
  };
}

/** The tag of the button with this test id, so `disabled` can be read off it. */
const buttonTag = (markup: string, testId: string) =>
  markup.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

const ready: NewAgeSendPhase = { kind: "ready", notice: null };

describe("the New Age send dialog", () => {
  it("names the world, the faction and the turn, and cannot send with an empty password", () => {
    const markup = draw(ready);
    expect(markup).toContain("Send orders to Arcanum");
    expect(markup).toContain("Merchant Guild (27) · turn 84 · atlantis-newage.com");
    expect(markup).toContain("Faction password");
    expect(markup).not.toContain("newage-faction-number");
    expect(markup).not.toContain(SIGN_IN_NOTE);
    expect(markup).toContain(">Send</button>");
    expect(buttonTag(markup, "newage-send-confirm")).toContain("disabled");
    expect(markup).not.toContain("newage-send-notice");
    expect(markup).not.toContain("newage-send-outcome");
  });

  it("asks for a faction number and reads `Sign in and send` when there is no session", () => {
    const markup = draw(ready, { asksSignIn: true });
    expect(markup).toContain("newage-faction-number");
    expect(markup).toContain('value="27"');
    expect(markup).toContain(">Sign in and send</button>");
  });

  it("sets out the errors and the warnings in two lists", () => {
    const markup = draw(
      verdictPhase({
        valid: false,
        errorCount: 3,
        errors: ["MOVE: no such direction.", "STUDY: not a skill.", "TAX: no permit."],
        warnings: ["Faction has unused tax points."],
        message: "Orders saved with 3 syntax errors"
      })
    );
    expect(markup).toContain("Orders for turn 84 were saved, but the world found 3 errors in them.");
    expect(markup).toContain("text-warn");
    expect(markup).toContain("newage-send-errors");
    expect(markup.match(/<li>/g)).toHaveLength(4);
    expect(markup).toContain("MOVE: no such direction.");
    expect(markup).toContain("newage-send-warnings");
    expect(markup).toContain("Faction has unused tax points.");
    // Both lists have entries, so the world's own message would only repeat them.
    expect(markup).not.toContain("newage-send-report");
    // Settled: nothing further to do here.
    expect(markup).toContain("newage-send-close");
    expect(markup).not.toContain("newage-send-confirm");
    expect(markup).not.toContain("newage-send-cancel");
    expect(markup).not.toContain("newage-password");
  });

  it("keeps the password field for a verdict that saved nothing, and quotes the world", () => {
    const markup = draw(
      verdictPhase({ saved: false, valid: false, message: "Неверный пароль фракции" })
    );
    expect(markup).toContain(
      "The world did not save these orders. Check the faction password and try again."
    );
    expect(markup).toContain("text-danger");
    expect(markup).toContain("newage-send-report");
    expect(markup).toContain("Неверный пароль фракции");
    expect(markup).toContain("newage-password");
    expect(markup).toContain("newage-send-cancel");
    expect(markup).toContain("newage-send-confirm");
    expect(markup).not.toContain("newage-send-close");
  });

  it("shows the session-ended notice above the fields", () => {
    const markup = draw({ kind: "ready", notice: SESSION_ENDED }, { asksSignIn: true });
    expect(markup).toContain("newage-send-notice");
    expect(markup).toContain(SESSION_ENDED);
    expect(markup.indexOf(SESSION_ENDED)).toBeLessThan(markup.indexOf("newage-password"));
    expect(markup).toContain("newage-faction-number");
  });

  it("quiets both fields while it is sending", () => {
    const markup = draw({ kind: "sending" }, { asksSignIn: true });
    expect(markup).toContain("Sending orders…");
    expect(markup).toContain("text-ink-soft");
    expect(
      markup.match(/<input[^>]*data-testid="newage-password"[^>]*>/)?.[0] ?? ""
    ).toContain("disabled");
    expect(
      markup.match(/<input[^>]*data-testid="newage-faction-number"[^>]*>/)?.[0] ?? ""
    ).toContain("disabled");
    expect(buttonTag(markup, "newage-send-confirm")).toContain("disabled");
  });

  it("says a world it could not reach is done with, and drops the turn it never knew", () => {
    const markup = draw({ kind: "unreachable" }, { turnNumber: null });
    expect(markup).toContain("Merchant Guild (27) · atlantis-newage.com");
    expect(markup).toContain("Could not reach atlantis-newage.com.");
    expect(markup).toContain("newage-send-close");
    expect(markup).not.toContain("newage-password");
  });

  it("shows a refusal in its own words and keeps the fields", () => {
    const markup = draw({
      kind: "failed",
      message: "The world refused the orders (500).",
      retype: false
    });
    expect(markup).toContain("The world refused the orders (500).");
    expect(markup).toContain("newage-password");
    expect(markup).toContain("newage-send-confirm");
  });
});
