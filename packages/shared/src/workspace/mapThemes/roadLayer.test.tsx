import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HEX_RADIUS } from "../mapViewport";
import { CONGESTED_CENTRE } from "./congestedFixture";
import { allBadges, buildHexViews, ROAD_VECTORS, type HexViewOptions } from "./hexView";
import { roadLayer, type RoadStyle } from "./roadLayer";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  badges: allBadges(true)
};

function draw(style: RoadStyle, options: Partial<HexViewOptions> = {}): string {
  const views = buildHexViews([CONGESTED_CENTRE], { ...ALL_ON, ...options });
  const RoadLayer = roadLayer(style);
  return renderToStaticMarkup(
    <svg>
      <RoadLayer views={views} />
    </svg>
  );
}

const ONE_STROKE: RoadStyle = {
  reach: 0.87,
  strokes: [{ className: "test-road", width: 0.2 }]
};

const TWO_STROKES: RoadStyle = {
  reach: 0.87,
  strokes: [
    { className: "test-road-under", width: 0.2 },
    { className: "test-road-over", width: 0.08, dash: "3 3" }
  ]
};

describe("the shared road layer", () => {
  it("draws one spoke per road, from the centre to reach along the bearing", () => {
    const [view] = buildHexViews([CONGESTED_CENTRE], ALL_ON);
    const svg = draw(ONE_STROKE);
    const lines = [...svg.matchAll(/<line[^>]*>/g)].map((match) => match[0]);

    expect(lines).toHaveLength(view.roads.length);
    view.roads.forEach((direction, index) => {
      const bearing = ROAD_VECTORS[direction];
      const line = lines[index];
      expect(line).toContain('class="test-road"');
      const x2 = Number(/\sx2="([-\d.]+)"/.exec(line)?.[1]);
      const y2 = Number(/\sy2="([-\d.]+)"/.exec(line)?.[1]);
      expect(x2).toBeCloseTo(view.at.x + bearing.x * HEX_RADIUS * 0.87, 2);
      expect(y2).toBeCloseTo(view.at.y + bearing.y * HEX_RADIUS * 0.87, 2);
    });
  });

  it("draws every stroke of a road in order, first underneath", () => {
    const svg = draw(TWO_STROKES);
    const lines = [...svg.matchAll(/<line[^>]*>/g)].map((match) => match[0]);

    // Two roads on the centre hex, two strokes each.
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('class="test-road-under"');
    expect(lines[1]).toContain('class="test-road-over"');
  });

  it("gives a stroke its width in hex units, never a screen-pixel effect", () => {
    const svg = draw(ONE_STROKE);

    expect(svg).not.toContain("vector-effect");
    expect(Number(/stroke-width="([\d.]+)"/.exec(svg)?.[1])).toBeCloseTo(HEX_RADIUS * 0.2, 2);
  });

  it("writes dash, linecap and opacity only when the style sets them", () => {
    const bare = draw(ONE_STROKE);
    expect(bare).not.toContain("stroke-dasharray");
    expect(bare).not.toContain("stroke-linecap");
    expect(bare).not.toContain("opacity=");

    const full = draw({
      reach: 0.87,
      strokes: [{ className: "test-road", width: 0.2, dash: "5 3", linecap: "round", opacity: 0.9 }]
    });
    expect(full).toContain('stroke-dasharray="5 3"');
    expect(full).toContain('stroke-linecap="round"');
    expect(full).toContain('opacity="0.9"');
  });

  it("draws nothing when the roads badge is off", () => {
    expect(draw(ONE_STROKE, { badges: allBadges(true, { roads: false }) })).not.toContain("<line");
  });

  it("keeps pointer events off the roads, and names its layer", () => {
    const svg = draw(ONE_STROKE);
    const outer = /<g[^>]*data-layer="roads"[^>]*>/.exec(svg)?.[0] ?? "";

    expect(outer).toContain('pointer-events="none"');
  });
});
