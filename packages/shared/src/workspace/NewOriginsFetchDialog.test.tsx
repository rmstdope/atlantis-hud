import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NEW_ORIGINS_HOST } from "./newOriginsApi";
import { NewOriginsFetchDialog } from "./NewOriginsFetchDialog";
import type { NewOriginsFetchPhase } from "./newOriginsFetchView";

const draw = (phase: NewOriginsFetchPhase, turnNumber: number | null = 83) =>
  renderToStaticMarkup(
    <NewOriginsFetchDialog
      host={NEW_ORIGINS_HOST}
      factionName="Merchant Guild"
      factionNumber="27"
      turnNumber={turnNumber}
      suggestedFactionNumber="27"
      phase={phase}
      onFetch={() => {}}
      onKeep={() => {}}
      onOpen={() => {}}
      onDismiss={() => {}}
    />
  );

describe("NewOriginsFetchDialog", () => {
  it("asks for a faction number and a password, and nothing else", () => {
    const markup = draw({ kind: "ready", message: null, retype: false });

    expect(markup).toContain("Fetch from New Origins");
    expect(markup).toContain("Merchant Guild (27) · turn 83 · atlantis-pbem.com");
    expect(markup).toContain('data-testid="newage-faction-number"');
    expect(markup).toContain('data-testid="newage-password"');
    expect(markup).toContain("Used for this fetch only. Nothing is written to this machine.");
    expect(markup).toContain('data-testid="neworigins-fetch-confirm"');
    expect(markup).toContain('data-testid="neworigins-fetch-cancel"');
    // There is one thing to fetch, so there are no scope radios at all.
    expect(markup).not.toContain("newage-fetch-scope-this-turn");
    expect(markup).not.toContain("newage-fetch-scope-history");
    expect(markup).not.toContain('data-testid="neworigins-fetch-working"');
  });

  it("drops what it does not know from the line under the heading", () => {
    const markup = renderToStaticMarkup(
      <NewOriginsFetchDialog
        host={NEW_ORIGINS_HOST}
        factionName={null}
        factionNumber={null}
        turnNumber={null}
        suggestedFactionNumber={null}
        phase={{ kind: "ready", message: null, retype: false }}
        onFetch={() => {}}
        onKeep={() => {}}
        onOpen={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(markup).toMatch(
      /data-testid="neworigins-fetch-meta"[^>]*>atlantis-pbem\.com</
    );
  });

  it("shows one line and Cancel alone while it works", () => {
    const markup = draw({ kind: "fetching" });

    expect(markup).toContain('data-testid="neworigins-fetch-working"');
    expect(markup).toContain("Fetching this turn&#x27;s report from New Origins…");
    expect(markup).toContain('data-testid="neworigins-fetch-cancel"');
    expect(markup).not.toContain('data-testid="neworigins-fetch-confirm"');
    expect(markup).not.toContain('data-testid="newage-password"');
  });

  it("names both turns when a newer one arrives", () => {
    const markup = draw({ kind: "askNewer", currentTurn: 83, incomingTurn: 84 });

    expect(markup).toContain('data-testid="neworigins-fetch-question"');
    expect(markup).toContain("Turn 84 has arrived. Opening it replaces turn 83 on screen");
    expect(markup).toContain("Keep turn 83");
    expect(markup).toContain("Open turn 84");
    expect(markup).toContain('data-testid="neworigins-fetch-keep"');
    expect(markup).toContain('data-testid="neworigins-fetch-open"');
    // The record gives this state exactly two buttons; Escape still dismisses.
    expect(markup).not.toContain('data-testid="neworigins-fetch-cancel"');
  });

  it("offers a reload when the same turn comes back", () => {
    const markup = draw({ kind: "askSame", turnNumber: 83 });

    expect(markup).toContain("New Origins still has turn 83 — the turn you already have.");
    expect(markup).toContain("Keep what I have");
    expect(markup).toContain("Load it again");
    expect(markup).not.toContain('data-testid="neworigins-fetch-cancel"');
  });

  it("shows a refusal in red and keeps the faction number", () => {
    const markup = draw({
      kind: "ready",
      message:
        "Faction password is incorrect. Try again or contact the Game Masters on Discord to change your password.",
      retype: true
    });

    expect(markup).toContain('data-testid="neworigins-fetch-message"');
    expect(markup).toContain(
      "Faction password is incorrect. Try again or contact the Game Masters on Discord to change your password."
    );
    expect(markup).toContain('value="27"');
  });
});
