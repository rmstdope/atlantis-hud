import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROW_PITCH } from "../mapViewport";
import { aHexView } from "./hexViewFixture";
import {
  COORDS_CLEARANCE_PX,
  COORDS_TOP_INSET,
  CoordsTail,
  coordsTopY,
  drawsHexCoordinates,
  HexCoordsLayer,
  markRoom,
  stepDownBy,
  StepsDown
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

describe("a mark in the coordinates' way steps down beneath them (ah-qf24)", () => {
  const coordsTop = -ROW_PITCH + radii(COORDS_TOP_INSET);

  it("measures how far below the coordinates' top a mark already begins", () => {
    expect(markRoom({ y: coordsTop + 3 })).toBeCloseTo(3);
    expect(markRoom({ y: coordsTop })).toBeCloseTo(0);
  });

  it("drops by nothing when the mark already sits clear, at the closest zoom", () => {
    expect(stepDownBy({ y: coordsTop + COORDS_CLEARANCE_PX }, 1)).toBe(0);
    expect(stepDownBy({ y: coordsTop + 10 }, 4)).toBe(0);
  });

  it("drops just far enough to clear the coordinates, further the further out the zoom", () => {
    const top = { y: coordsTop + 1 };
    expect(stepDownBy(top, 4)).toBeCloseTo(COORDS_CLEARANCE_PX / 4 - 1);
    expect(stepDownBy(top, 1)).toBeCloseTo(COORDS_CLEARANCE_PX - 1);
    expect(stepDownBy(top, 0.7)).toBeGreaterThan(stepDownBy(top, 1));
  });

  it("counts screen-constant lettering reaching above the mark's anchor", () => {
    expect(stepDownBy({ y: coordsTop + 1, abovePx: 8 }, 2)).toBeCloseTo(
      (COORDS_CLEARANCE_PX + 8) / 2 - 1
    );
  });

  it("is the clearance the stylesheet steps marks down by, in the bands the coordinates show", () => {
    const css = readFileSync(new URL("../../theme.css", import.meta.url), "utf8");
    expect(css).toContain(".map-mid .map-steps-down,\n.map-near .map-steps-down:not([data-named])");
    expect(css).toContain(`(${COORDS_CLEARANCE_PX}px + var(--mark-above, 0px))`);
  });

  it("wraps the mark only while its hex carries coordinates", () => {
    const mark = <circle data-mark="battle" r={2} />;
    const plain = draw(
      <StepsDown view={PLAIN} named={false} top={{ y: coordsTop + 1, abovePx: 7 }}>
        {mark}
      </StepsDown>
    );
    expect(plain).toContain('class="map-steps-down"');
    expect(plain).toContain("data-steps-down");
    expect(plain).toContain("--mark-room:1px");
    expect(plain).toContain("--mark-above:7px");
    expect(plain).not.toContain("data-named");
    expect(plain).toContain('data-mark="battle"');

    const named = draw(
      <StepsDown view={NAMED} named top={{ y: coordsTop + 1 }}>
        {mark}
      </StepsDown>
    );
    expect(named).toContain('data-named="true"');
    expect(named).toContain("--mark-unit:1");
    const scaled = draw(
      <StepsDown view={PLAIN} named={false} top={{ y: coordsTop }} unit={0.5625}>
        {mark}
      </StepsDown>
    );
    expect(scaled).toContain("--mark-unit:0.5625");
    expect(named).toContain("--mark-above:0px");

    for (const view of [OFF, null]) {
      const bare = draw(
        <StepsDown view={view} named={false} top={{ y: coordsTop }}>
          {mark}
        </StepsDown>
      );
      expect(bare).not.toContain("data-steps-down");
      expect(bare).toContain('data-mark="battle"');
    }
  });
});
