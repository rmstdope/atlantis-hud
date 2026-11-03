import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { findByTestId, queryByTestId } from "../testing/elementTree";
import type { OldAddressPhase } from "./OldAddressNotice";
import { OldAddressNoticeView } from "./OldAddressNotice";

const callbacks = () => ({ onSaveAll: vi.fn(), onStay: vi.fn(), onGoToNewAddress: vi.fn() });

function view(hasGames: boolean, phase: OldAddressPhase = { kind: "idle" }, handlers = callbacks()) {
  return <OldAddressNoticeView hasGames={hasGames} phase={phase} {...handlers} />;
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

describe("the old address dialog", () => {
  it("is a modal dialog named by its heading, saying where the app has gone", () => {
    const markup = renderToStaticMarkup(view(true));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="This address is closing down"');
    expect(markup).toContain(">This address is closing down</h2>");
    expect(text(markup)).toContain(
      "Atlantis HUD has moved to atlantis-hud.rmstdope.eu. This address, atlantis-hud.kurelid.se, gets no updates after version 0.35.0."
    );
  });

  it("links the new address in a new tab, in the paragraph and in step 2", () => {
    const markup = renderToStaticMarkup(view(true));
    const links = [
      ...markup.matchAll(/<a href="https:\/\/atlantis-hud\.rmstdope\.eu" target="_blank" rel="noopener noreferrer"[^>]*>atlantis-hud\.rmstdope\.eu<\/a>/g)
    ];
    expect(links).toHaveLength(2);
  });

  it("with games, explains the move in three steps, focusing Save all my games", () => {
    const markup = renderToStaticMarkup(view(true));
    const words = text(markup);
    expect(words).toContain(
      "Your games are saved in this browser for this address only, so the new address cannot see them. To take them with you:"
    );
    expect(words).toContain("Save all my games — saves one backup file per game to your downloads.");
    expect(words).toContain("Open atlantis-hud.rmstdope.eu.");
    expect(words).toContain("There: choose Import game backup… and pick each file you saved.");
    expect(markup).toMatch(/<strong[^>]*>Import game backup…<\/strong>/);
    expect(markup).toMatch(/<ol[^>]*>(?:(?!<\/ol>).)*<li/s);
    expect(markup).not.toContain("nothing to move");
    expect(findByTestId(view(true), "old-address-save-all").props.autoFocus).toBe(true);
    expect(findByTestId(view(true), "old-address-go").props.autoFocus).toBeFalsy();
  });

  it("with no games, says there is nothing to move and focuses Go to the new address", () => {
    const markup = renderToStaticMarkup(view(false));
    expect(text(markup)).toContain("You have no games saved at this address, so there is nothing to move.");
    expect(markup).not.toContain("To take them with you");
    expect(markup).not.toContain("<ol");
    expect(queryByTestId(view(false), "old-address-save-all")).toBeNull();
    expect(findByTestId(view(false), "old-address-go").props.autoFocus).toBe(true);
  });

  it("offers Stay here for now and Go to the new address, in that order, wired to their handlers", () => {
    const handlers = callbacks();
    const markup = renderToStaticMarkup(view(true, { kind: "idle" }, handlers));
    expect(markup.indexOf("Stay here for now")).toBeLessThan(markup.indexOf("Go to the new address"));
    (findByTestId(view(true, { kind: "idle" }, handlers), "old-address-stay").props.onClick as () => void)();
    (findByTestId(view(true, { kind: "idle" }, handlers), "old-address-go").props.onClick as () => void)();
    (findByTestId(view(true, { kind: "idle" }, handlers), "old-address-save-all").props.onClick as () => void)();
    expect(handlers.onStay).toHaveBeenCalledTimes(1);
    expect(handlers.onGoToNewAddress).toHaveBeenCalledTimes(1);
    expect(handlers.onSaveAll).toHaveBeenCalledTimes(1);
  });

  it("while saving, disables the button and counts", () => {
    const saving = view(true, { kind: "saving", done: 2, total: 3 });
    const button = findByTestId(saving, "old-address-save-all");
    expect(button.props.disabled).toBe(true);
    expect(text(renderToStaticMarkup(saving))).toContain("Saving… 2 of 3");
  });

  it("once saved, lists every file in green under the button", () => {
    const saved = view(true, {
      kind: "finished",
      outcome: { saved: ["Nexus.json", "Ered Luin.json", "Test.json"], failed: [] }
    });
    expect(findByTestId(saved, "old-address-save-all").props.disabled).toBeFalsy();
    const markup = renderToStaticMarkup(saved);
    expect(text(markup)).toContain("Save all my games");
    expect(findByTestId(saved, "old-address-saved").props.className).toContain("text-ok");
    expect(text(markup)).toContain("Saved 3 games: Nexus.json, Ered Luin.json, Test.json");
    expect(queryByTestId(saved, "old-address-failed")).toBeNull();
  });

  it("lists only what was saved in green, and each failed game in red", () => {
    const partial = view(true, {
      kind: "finished",
      outcome: { saved: ["Nexus.json", "Test.json"], failed: ["Ered Luin", "Bree"] }
    });
    const words = text(renderToStaticMarkup(partial));
    expect(words).toContain("Saved 2 games: Nexus.json, Test.json");
    expect(words).toContain("Couldn’t save Ered Luin. Press the button to try again.");
    expect(words).toContain("Couldn’t save Bree. Press the button to try again.");
    expect(findByTestId(partial, "old-address-failed").props.className).toContain("text-danger");
  });

  it("shows no green line when nothing was saved", () => {
    const none = view(true, { kind: "finished", outcome: { saved: [], failed: ["Nexus"] } });
    expect(queryByTestId(none, "old-address-saved")).toBeNull();
    expect(text(renderToStaticMarkup(none))).toContain("Couldn’t save Nexus.");
  });
});
