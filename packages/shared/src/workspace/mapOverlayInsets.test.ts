import { describe, expect, it } from "vitest";
import { overlayInsets, type Edge, type OverlayBox } from "./mapOverlayInsets";

const HOST = { left: 0, right: 1000, top: 0, bottom: 800 };

function box(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom };
}

describe("measuring what the panes cover", () => {
  it("reads each pane as the gap between its far edge and the edge it sits on", () => {
    const overlays: OverlayBox[] = [
      { edge: "left", box: box(10, 48, 314, 700) },
      { edge: "right", box: box(654, 48, 990, 700) },
      { edge: "top", box: box(400, 10, 600, 42) },
      { edge: "bottom", box: box(10, 620, 990, 790) }
    ];

    expect(overlayInsets(HOST, overlays)).toEqual({
      left: 314,
      right: 346,
      top: 42,
      bottom: 180
    });
  });

  it("measures from the host rather than the window, so a map below a header is not misread", () => {
    // The host is offset down the page; a pane's own coordinates are in the same space, so the
    // inset is the difference, not the raw coordinate.
    const host = { left: 100, right: 1100, top: 200, bottom: 1000 };

    expect(overlayInsets(host, [{ edge: "left", box: box(110, 240, 414, 900) }]).left).toBe(314);
    expect(overlayInsets(host, [{ edge: "top", box: box(500, 210, 700, 242) }]).top).toBe(42);
  });

  it("keeps the deepest pane when several claim the same edge", () => {
    const insets = overlayInsets(HOST, [
      { edge: "left", box: box(10, 48, 200, 300) },
      { edge: "left", box: box(10, 320, 314, 700) }
    ]);

    expect(insets.left).toBe(314);
  });

  it("ignores a pane with nothing in it, so a folded or empty slot gives its space back", () => {
    const insets = overlayInsets(HOST, [{ edge: "bottom", box: box(10, 790, 990, 790) }]);

    expect(insets.bottom).toBe(0);
  });

  it("never reports a negative inset for a pane that has drifted off the host", () => {
    const insets = overlayInsets(HOST, [{ edge: "left", box: box(-300, 48, -20, 700) }]);

    expect(insets.left).toBe(0);
  });

  it("reports nothing when no pane is over the map", () => {
    expect(overlayInsets(HOST, [])).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("ignores a pane that names an edge there is no such thing as", () => {
    // The edge arrives as an HTML attribute, so it is whatever someone typed. A misspelling that
    // silently became a NaN inset would take the framing with it, and the map would open nowhere.
    const insets = overlayInsets(HOST, [
      { edge: "middle" as Edge, box: box(10, 48, 314, 700) },
      { edge: undefined as unknown as Edge, box: box(10, 48, 314, 700) },
      { edge: "left", box: box(10, 48, 200, 700) }
    ]);

    expect(insets).toEqual({ left: 200, right: 0, top: 0, bottom: 0 });
    expect(Object.values(insets).every(Number.isFinite)).toBe(true);
  });
});
