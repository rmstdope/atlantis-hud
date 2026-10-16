import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROW_PITCH } from "../mapViewport";
import { aHexView } from "./hexViewFixture";
import {
  COORDS_TOP_INSET,
  CoordsTail,
  coordsTopY,
  drawsHexCoordinates,
  HexCoordsLayer
} from "./hexCoords";
import { radii } from "./geometry";
import type { HexView } from "./hexView";

const draw = (node: ReactElement) => renderToStaticMarkup(<svg>{node}</svg>);

const PLAIN = aHexView({ key: "1:33,25", at: { x: 891, y: 389.7 }, coords: "33,25" });
const NAMED = aHexView({
  key: "1:31,23",
  at: { x: 837, y: 358.5 },
  coords: "31,23",
  settlement: { name: "Kerrin", tier: "city" }
});
const OFF = aHexView({ key: "1:35,27", coords: null });

const namedBySettlement = (view: HexView) => view.settlement !== null;

describe("where hex coordinates are drawn (ah-ezyg)", () => {
  it("at close and middle zoom while the switch is on, and never far out or switched off", () => {
    expect(drawsHexCoordinates("near", true)).toBe(true);
    expect(drawsHexCoordinates("mid", true)).toBe(true);
    expect(drawsHexCoordinates("far", true)).toBe(false);
    expect(drawsHexCoordinates("near", false)).toBe(false);
    expect(drawsHexCoordinates("mid", false)).toBe(false);
  });

  it("just inside the hex's top edge, centred on it", () => {
    expect(coordsTopY(PLAIN)).toBeCloseTo(PLAIN.at.y - ROW_PITCH + radii(COORDS_TOP_INSET));
    expect(COORDS_TOP_INSET).toBeGreaterThan(0);
    expect(COORDS_TOP_INSET).toBeLessThan(0.2);

    const markup = draw(<HexCoordsLayer views={[PLAIN]} writesName={namedBySettlement} />);
    expect(markup).toContain(`x="${PLAIN.at.x}"`);
    expect(markup).toContain('text-anchor="middle"');
    expect(markup).toContain('class="map-coords"');
    expect(markup).toContain(">33,25</text>");
  });
});

describe("the coordinates layer", () => {
  it("labels every hex that carries coordinates, and no other", () => {
    const markup = draw(
      <HexCoordsLayer views={[PLAIN, NAMED, OFF]} writesName={namedBySettlement} />
    );

    expect(markup.match(/data-hex-coords=/g)).toHaveLength(2);
    expect(markup).toContain('data-hex-coords="1:33,25"');
    expect(markup).toContain('data-hex-coords="1:31,23"');
    expect(markup).not.toContain("1:35,27");
  });

  it("marks the hexes whose name carries the coordinates, so close zoom can leave the top edge to the name", () => {
    const markup = draw(<HexCoordsLayer views={[PLAIN, NAMED]} writesName={namedBySettlement} />);

    expect(markup).toMatch(/data-hex-coords="1:31,23"[^>]*data-named="true"/);
    expect(markup).not.toMatch(/data-hex-coords="1:33,25"[^>]*data-named/);
  });

  it("asks the theme, not the settlement, whether the name is written", () => {
    const markup = draw(<HexCoordsLayer views={[NAMED]} writesName={() => false} />);

    expect(markup).not.toContain("data-named");
  });

  it("draws nothing when no hex carries coordinates", () => {
    expect(renderToStaticMarkup(<HexCoordsLayer views={[OFF]} writesName={namedBySettlement} />)).toBe("");
  });

  it("keeps pointer events off", () => {
    expect(draw(<HexCoordsLayer views={[PLAIN]} writesName={namedBySettlement} />)).toContain(
      'pointer-events="none"'
    );
  });
});

describe("the coordinates after a settlement's name", () => {
  it("follow the name after one space, in the coordinates' own print", () => {
    const markup = draw(
      <text>
        Kerrin
        <CoordsTail coords="33,25" />
      </text>
    );

    expect(markup).toContain('class="map-coords map-coords-tail"');
    expect(markup).toContain("data-coords-tail");
    expect(markup).toContain("> 33,25</tspan>");
  });

  it("add nothing while the switch is off", () => {
    expect(renderToStaticMarkup(<CoordsTail coords={null} />)).toBe("");
  });
});
