import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShortcutHelp } from "./ShortcutHelp";

/**
 * The overlay a first-time player is greeted by.
 *
 * It is no longer a list of chords: a player who reaches for the mouse is the likelier of the two,
 * and until now nothing in the application told them the map pans by dragging or that Shift turns
 * the drag into an export. What is asserted here is that both columns are on screen and that the
 * chords read in the platform's own spelling; the smoke suite says the gestures are true.
 */

function markup(isMac: boolean): string {
  return renderToStaticMarkup(<ShortcutHelp isMac={isMac} onDismiss={() => {}} />);
}

describe("ShortcutHelp", () => {
  it("is about getting around, not only about shortcuts", () => {
    const html = markup(false);
    expect(html).toContain("Getting around");
    expect(html).toContain("Mouse");
    expect(html).toContain("Keyboard");
  });

  it("tells a mouse user how to work the map", () => {
    const html = markup(false);
    expect(html).toContain("Drag");
    expect(html).toContain("wheel");
    expect(html).toContain("Shift");
  });

  it("still lists the chords, in the spelling of the platform it is shown on", () => {
    expect(markup(true)).toContain("⌘K");
    expect(markup(false)).toContain("Ctrl+K");
    expect(markup(false)).not.toContain("⌘K");
  });

  it("scrolls, because it now holds more than a screenful", () => {
    // The overlay grew past the height a small window can show. Its body scrolls rather than the
    // dialog growing off the top and bottom of the screen, taking the close button with it.
    expect(markup(false)).toMatch(/data-testid="shortcut-help-body"[^>]*overflow-y-auto/);
  });

  it("gives the scrolling region a name, since it is a focus stop", () => {
    // Focusable so a keyboard-only reader can scroll it, which makes it somewhere a screen reader
    // arrives - and an unnamed arrival says nothing about what has been reached.
    const html = markup(false);
    expect(html).toMatch(/data-testid="shortcut-help-body"[^>]*aria-label="[^"]+"/);
    expect(html).toMatch(/data-testid="shortcut-help-body"[^>]*tabindex="0"/);
  });

  it("still carries the startup switch and a way out", () => {
    const html = markup(false);
    expect(html).toContain('data-testid="shortcut-help-at-startup"');
    expect(html).toContain('data-testid="shortcut-help-close"');
  });
});
