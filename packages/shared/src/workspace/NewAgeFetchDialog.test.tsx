import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AssistantFetchPrompt } from "../assistant/assistantFetch";
import { NewAgeFetchDialog } from "./NewAgeFetchDialog";
import type { NewAgeFetchPhase, NewAgeFetchScope } from "./newAgeFetchView";
import { NEW_AGE_HOST } from "./newAgeSignInView";

const draw = (phase: NewAgeFetchPhase, initialScope?: NewAgeFetchScope, assistant?: AssistantFetchPrompt) =>
  renderToStaticMarkup(
    <NewAgeFetchDialog
      initialScope={initialScope}
      assistant={assistant}
      rulesetLabel="New Age: Arcanum"
      worldName="Arcanum"
      host={NEW_AGE_HOST}
      turnNumber={83}
      suggestedFactionNumber="27"
      phase={phase}
      onFetch={() => {}}
      onKeep={() => {}}
      onOpen={() => {}}
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
    expect(markup).toContain("All reports not yet fetched/imported");
    expect(markup).toContain('data-testid="newage-fetch-confirm"');
    expect(markup).not.toContain('data-testid="newage-fetch-working"');
  });

  it("explains the disabled Fetch button while the password is empty", () => {
    const markup = draw({ kind: "ready", message: null, retype: false });
    const button = markup.match(/<button[^>]*data-testid="newage-fetch-confirm"[^>]*>/)?.[0];

    expect(button).toContain("disabled");
    expect(button).toContain('title="Password must be entered"');
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

  it("opens on Latest report unless told otherwise", () => {
    const markup = draw({ kind: "ready", message: null, retype: false });
    expect(radio(markup, "newage-fetch-scope-this-turn")).toContain("checked");
    expect(radio(markup, "newage-fetch-scope-history")).not.toContain("checked");
  });

  it("opens with the palette's choice already ticked (ah-mlls.7)", () => {
    const markup = draw({ kind: "ready", message: null, retype: false }, "thisTurnAndHistory");
    expect(radio(markup, "newage-fetch-scope-history")).toContain("checked");
    expect(radio(markup, "newage-fetch-scope-this-turn")).not.toContain("checked");
  });
});

function radio(markup: string, testId: string): string {
  return markup.match(new RegExp(`<input[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
}

describe("NewAgeFetchDialog when the assistant asked (ah-9vmbx.3)", () => {
  const ready: NewAgeFetchPhase = { kind: "ready", message: null, retype: false };

  it("shows the assistant's line and note, and leaves out the choice of what to fetch", () => {
    const markup = draw(ready, undefined, "asking");

    expect(markup).toContain("The assistant is asking for this turn&#x27;s report.");
    expect(markup).toContain(
      "Used for this fetch only. The assistant never sees it, and nothing is written to this machine."
    );
    expect(markup).not.toContain("Used for this fetch only. Nothing is written to this machine.");
    expect(markup).not.toContain('data-testid="newage-fetch-scope-this-turn"');
    expect(markup).not.toContain("All reports not yet fetched/imported");
    expect(markup).toContain('data-testid="newage-password"');
  });

  it("puts the line between the heading and the meta line", () => {
    const markup = draw(ready, undefined, "asking");
    const heading = markup.indexOf("Fetch from New Age: Arcanum");
    const line = markup.indexOf('data-testid="assistant-fetch-line"');
    const meta = markup.indexOf('data-testid="newage-fetch-meta"');

    expect(heading).toBeLessThan(line);
    expect(line).toBeLessThan(meta);
  });

  it("keeps the line while it works", () => {
    expect(draw({ kind: "signingIn" }, undefined, "asking")).toContain(
      "The assistant is asking for this turn&#x27;s report."
    );
  });

  it("says the assistant stopped waiting, and still offers the fetch", () => {
    const markup = draw(ready, undefined, "stopped");

    expect(markup).toContain("The assistant stopped waiting. You can still fetch this turn&#x27;s report here.");
    expect(markup).not.toContain("The assistant is asking");
    expect(markup).toContain("The assistant never sees it");
    expect(markup).toContain('data-testid="newage-fetch-confirm"');
  });

  it("adds nothing for the player's own Fetch", () => {
    const markup = draw(ready);

    expect(markup).not.toContain('data-testid="assistant-fetch-line"');
    expect(markup).not.toContain("The assistant never sees it");
  });
});

describe("NewAgeFetchDialog, asking before the screen is replaced (ah-1y7yi)", () => {
  const askNewer: NewAgeFetchPhase = {
    kind: "askNewer",
    currentTurn: 83,
    incomingTurn: 84,
    earlierStored: 0,
    notFetched: 0
  };

  it("asks Keep turn N / Open turn M in place of the working line, with nothing else to press", () => {
    const markup = draw(askNewer);

    expect(markup).toContain(
      "Turn 84 has arrived. Opening it replaces turn 83 on screen. Your turn 83 orders and notes are kept with turn 83."
    );
    expect(markup).toContain("Fetch from New Age: Arcanum");
    expect(markup).toContain("atlantis-newage.com · turn 83");
    expect(markup).toMatch(/data-testid="newage-fetch-keep"[^>]*>Keep turn 83</);
    expect(markup).toMatch(/data-testid="newage-fetch-open"[^>]*>Open turn 84</);
    // Keep first, so the stacked footer puts Open above it, as on New Origins.
    expect(markup.indexOf("newage-fetch-keep")).toBeLessThan(markup.indexOf("newage-fetch-open"));
    for (const gone of [
      "newage-password",
      "newage-fetch-scope-history",
      "newage-fetch-cancel",
      "newage-fetch-confirm",
      "newage-fetch-working"
    ]) {
      expect(markup).not.toContain(`data-testid="${gone}"`);
    }
  });

  it("counts the earlier turns of an All reports run", () => {
    const markup = draw({ ...askNewer, incomingTurn: 86, earlierStored: 2 });

    expect(markup).toContain(
      "Turn 86 has arrived, along with 2 earlier turns, which are stored for history."
    );
  });

  it("asks Keep what I have / Load it again for the same turn, naming the world", () => {
    const markup = draw({ kind: "askSame", turnNumber: 83, earlierStored: 0, notFetched: 0 });

    expect(markup).toContain(
      "Arcanum still has turn 83 — the turn you already have. Loading it again refreshes the report on screen. Your orders and notes stay as they are."
    );
    expect(markup).toMatch(/data-testid="newage-fetch-keep"[^>]*>Keep what I have</);
    expect(markup).toMatch(/data-testid="newage-fetch-open"[^>]*>Load it again</);
  });

  it("keeps the assistant's line on top while it asks", () => {
    const markup = draw(askNewer, undefined, "asking");

    expect(markup).toContain('data-testid="assistant-fetch-line"');
    expect(markup.indexOf("The assistant is asking")).toBeLessThan(markup.indexOf("Turn 84 has arrived"));
  });
});
