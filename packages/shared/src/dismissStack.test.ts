import { afterEach, describe, expect, it } from "vitest";
import { hasOpenDismissLayers, pushDismissLayer, isTopDismissLayer, subscribeDismissLayers } from "./dismissStack";

const cleanups: Array<() => void> = [];

function open(): unknown {
  const layer = pushDismissLayer();
  cleanups.push(layer);
  return layer;
}

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("dismiss stack", () => {
  it("calls the only open layer the top", () => {
    const settings = open();
    expect(isTopDismissLayer(settings)).toBe(true);
  });

  it("puts the most recently opened layer on top", () => {
    const settings = open();
    const palette = open();
    expect(isTopDismissLayer(palette)).toBe(true);
    expect(isTopDismissLayer(settings)).toBe(false);
  });

  it("hands the top back when the layer above closes", () => {
    const settings = open();
    const palette = pushDismissLayer();
    palette();
    expect(isTopDismissLayer(settings)).toBe(true);
    expect(isTopDismissLayer(palette)).toBe(false);
  });

  it("survives layers closing out of order", () => {
    const settings = pushDismissLayer();
    const palette = open();
    settings();
    expect(isTopDismissLayer(palette)).toBe(true);
  });

  it("knows whether anything at all is open", () => {
    expect(hasOpenDismissLayers()).toBe(false);
    const layer = open();
    expect(hasOpenDismissLayers()).toBe(true);
    void layer;
  });

  it("tells subscribers when a layer opens or closes, until they unsubscribe", () => {
    let told = 0;
    const unsubscribe = subscribeDismissLayers(() => {
      told += 1;
    });
    const close = pushDismissLayer();
    expect(told).toBe(1);
    close();
    expect(told).toBe(2);
    // Closing a layer that is already gone changes nothing, so nobody is told.
    close();
    expect(told).toBe(2);
    unsubscribe();
    pushDismissLayer()();
    expect(told).toBe(2);
  });
});
