import type { Coordinate, TradeRoute } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { isOffScreen, NO_INSETS, type Viewport } from "./mapViewport";
import { arrowFor, viewportForArrow } from "./tradeArrow";

const WIDTH = 800;
const HEIGHT = 600;
const VIEW: Viewport = { tx: 400, ty: 300, step: 0 };

function hex(x: number, y: number): Coordinate {
  return { x, y, z: 1 };
}

function route(from: Coordinate, to: Coordinate, circuit = false): TradeRoute {
  return {
    from,
    to,
    outbound: [],
    inbound: circuit ? ([{}] as unknown as TradeRoute["inbound"]) : [],
    worth: 0,
    turns: { walk: null, ride: null, fly: null }
  };
}

describe("arrowFor", () => {
  it("draws a single head for a one-way route", () => {
    expect(arrowFor(route(hex(1, 2), hex(3, 4)))).toEqual({
      from: hex(1, 2),
      to: hex(3, 4),
      twoWay: false
    });
  });

  it("draws a head at both ends of a circuit", () => {
    expect(arrowFor(route(hex(1, 2), hex(3, 4), true))?.twoWay).toBe(true);
  });

  it("draws nothing when nothing is hovered", () => {
    expect(arrowFor(null)).toBeNull();
  });
});

describe("viewportForArrow", () => {
  it("leaves the map alone for a route already on screen", () => {
    const arrow = arrowFor(route(hex(0, 0), hex(1, 1)))!;
    expect(viewportForArrow(arrow, VIEW, WIDTH, HEIGHT, NO_INSETS)).toBeNull();
  });

  it("frames a route with an end off screen", () => {
    const arrow = arrowFor(route(hex(0, 0), hex(60, 80)))!;
    const fitted = viewportForArrow(arrow, VIEW, WIDTH, HEIGHT, NO_INSETS);
    expect(fitted).not.toBeNull();
    expect(isOffScreen(arrow.from, fitted!, WIDTH, HEIGHT, NO_INSETS)).toBe(false);
    expect(isOffScreen(arrow.to, fitted!, WIDTH, HEIGHT, NO_INSETS)).toBe(false);
  });

  it("leaves the map alone when there is no room to frame anything", () => {
    const arrow = arrowFor(route(hex(0, 0), hex(200, 400)))!;
    expect(viewportForArrow(arrow, VIEW, 0, 0, NO_INSETS)).toBeNull();
  });
});
