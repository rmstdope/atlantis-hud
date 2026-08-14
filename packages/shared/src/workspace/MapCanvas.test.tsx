import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexMapModel } from "../hexMapModel";
import { MapCanvas } from "./MapCanvas";
import { CONGESTED_HEXES } from "./mapThemes/congestedFixture";
import { allBadges } from "./mapThemes/hexView";
import type { LayerProps, MapTheme } from "./mapThemes/mapTheme";

/**
 * What the map promises a theme, as opposed to what any one theme does with it.
 *
 * Rendered with a probe theme whose every layer does nothing but announce itself, so the assertions
 * are about composition alone: which layers are called, in what order, over which hexes, and what
 * the map stamps on its own root. `docs/ui/map-themes.md` states all of this to theme authors, and
 * nothing else checks it - the smoke suite exercises the map through whichever theme is the
 * default, which would go on looking right if the contract quietly changed underneath it.
 */
function probe(): MapTheme {
  const mark = (layer: string) => (props: LayerProps) => (
    <g data-layer={layer} data-count={props.views.length} />
  );
  return {
    id: "probe",
    label: "Probe",
    Defs: () => <linearGradient id="probe-gradient" />,
    TerrainLayer: (props) => (
      // The knowledge of the bucket, so the three calls can be told apart and ordered.
      <g data-layer="terrain" data-knowledge={props.views[0]?.knowledge ?? "empty"} />
    ),
    RoadLayer: mark("roads"),
    MarkLayer: mark("marks")
  };
}

const model: HexMapModel = {
  hexes: CONGESTED_HEXES,
  levels: [1],
  currentTurn: 71,
  initialSelectedRegionId: null
};

function draw(theme: MapTheme = probe()): string {
  return renderToStaticMarkup(
    <MapCanvas
      gameId={null}
      model={model}
      theme={theme}
      level={1}
      selectedRegionId={null}
      onSelectRegion={() => {}}
      showStaleness
      showTextures={false}
      badges={allBadges(true)}
    />
  );
}

/** The same map, with a one-step route drawn across it and the hex entered assessed as risky. */
function drawWithRoute(): string {
  return renderToStaticMarkup(
    <MapCanvas
      gameId={null}
      model={model}
      theme={probe()}
      level={1}
      selectedRegionId={null}
      onSelectRegion={() => {}}
      showStaleness
      showTextures={false}
      badges={allBadges(true)}
      route={{ origin: { x: 7, y: 53, z: 1 }, hexes: [{ x: 7, y: 51, z: 1 }], solidSteps: 1 }}
      routeRisk={[
        {
          coordinate: { x: 7, y: 51, z: 1 },
          level: "high",
          hostileStrength: 6,
          ownStrength: 1,
          foreignUnits: 6,
          monsters: 2,
          guards: 0,
          unknown: false,
          lastSeenTurn: 71,
          reason: "six foreign units and two monsters"
        }
      ]}
    />
  );
}

describe("what the map hands a theme", () => {
  it("draws terrain weakest-knowledge first, so better knowledge is never buried", () => {
    const order = [...draw().matchAll(/data-layer="terrain" data-knowledge="(\w+)"/g)].map(
      (match) => match[1]
    );

    // The fixture holds current and stale hexes but none known only by name, so the first bucket
    // is empty - it is still drawn, and still drawn first.
    expect(order).toEqual(["empty", "stale", "current"]);
  });

  it("draws roads before marks, and both over every hex on the level", () => {
    const svg = draw();
    const layers = [...svg.matchAll(/data-layer="(roads|marks)" data-count="(\d+)"/g)];

    expect(layers.map((match) => match[1])).toEqual(["roads", "marks"]);
    expect(layers.map((match) => Number(match[2]))).toEqual([
      CONGESTED_HEXES.length,
      CONGESTED_HEXES.length
    ]);
  });

  it("keeps roads beneath the route overlay, the way a traveller crosses one", () => {
    const svg = draw();

    expect(svg.indexOf('data-layer="roads"')).toBeLessThan(svg.indexOf('data-layer="marks"'));
  });

  it("draws an outline and a name for every piece when the regions badge is on", () => {
    // The whole congested neighbourhood is one connected piece of "Inhead".
    const svg = draw();

    expect(svg).toContain('data-testid="region-decorations"');
    expect((svg.match(/class="region-outline"/g) ?? []).length).toBe(1);
    expect((svg.match(/class="region-outline-halo"/g) ?? []).length).toBe(1);
    // The halo pass draws first, so it never buries an ink path along a shared province boundary.
    expect(svg.indexOf('class="region-outline-halo"')).toBeLessThan(
      svg.indexOf('class="region-outline"')
    );
    expect(svg).toContain("Inhead");
  });

  it("keeps the province border screen-constant, dashes included", () => {
    const svg = draw();
    const inkTag = /<path[^>]*class="region-outline"[^>]*\/?>/.exec(svg)?.[0] ?? "";
    const haloTag = /<path[^>]*class="region-outline-halo"[^>]*\/?>/.exec(svg)?.[0] ?? "";

    expect(inkTag).toContain('vector-effect="non-scaling-stroke"');
    expect(haloTag).toContain('vector-effect="non-scaling-stroke"');
  });

  it("draws nothing when the regions badge is off", () => {
    const svg = draw();
    const withoutRegions = renderToStaticMarkup(
      <MapCanvas
        gameId={null}
        model={model}
        theme={probe()}
        level={1}
        selectedRegionId={null}
        onSelectRegion={() => {}}
        showStaleness
        showTextures={false}
        badges={allBadges(true, { regions: false })}
      />
    );

    expect(svg).toContain('data-testid="region-decorations"');
    expect(withoutRegions).not.toContain('data-testid="region-decorations"');
    expect(withoutRegions).not.toContain("region-outline");
    expect(withoutRegions).not.toContain("region-outline-halo");
  });

  it("sits the region decorations after the roads layer and before the route overlay and marks", () => {
    const svg = draw();

    expect(svg.indexOf('data-layer="roads"')).toBeLessThan(
      svg.indexOf('data-testid="region-decorations"')
    );
    expect(svg.indexOf('data-testid="region-decorations"')).toBeLessThan(
      svg.indexOf('data-layer="marks"')
    );
  });

  it("renders the theme's own defs among the map's", () => {
    const svg = draw();

    // Inside the shared defs, beside the fog lattice rather than loose in the document.
    expect(svg).toContain('id="probe-gradient"');
    expect(svg.indexOf('id="fog-lattice"')).toBeLessThan(svg.indexOf('id="probe-gradient"'));
    expect(svg.indexOf('id="probe-gradient"')).toBeLessThan(svg.indexOf("</defs>"));
  });

  it("names the theme on its root, which is what a theme's stylesheet hangs off", () => {
    expect(draw()).toContain("map-theme-probe");
  });

  it("asks nothing of a theme beyond the three layers, defs being optional", () => {
    const bare: MapTheme = {
      id: "bare",
      label: "Bare",
      TerrainLayer: () => null,
      RoadLayer: () => null,
      MarkLayer: () => null
    };

    expect(() => draw(bare)).not.toThrow();
  });

  it("measures the route and its risk in the hex's units, as a theme's roads are", () => {
    // The route crosses the same hexes the roads run through, and both are drawn under the world
    // transform. Pinned to screen pixels a 5px casing stops matching the ground as the map zooms
    // out - at minimum zoom a hex is 9px across - and it buries the road it should be read against.
    // 5, 3 and 2 are the weights the map has always drawn: at rest the scale is 1, so this is what
    // it looked like before, and only the zoomed views change.
    const svg = drawWithRoute();
    // The route's own polylines only. `stroke-brass` is also the selection ring's class, but that
    // is a polygon and keeps its screen-constant stroke deliberately.
    const lines = [...svg.matchAll(/<polyline[^>]*>/g)]
      .map((match) => match[0])
      .filter((tag) => /stroke-ground|stroke-brass/.test(tag));
    const risk = /<polygon[^>]*fill-opacity="0\.28"[^>]*>/.exec(svg)?.[0] ?? "";
    const widthOf = (tag: string) => Number(/stroke-width="([\d.]+)"/.exec(tag)?.[1]);

    expect(lines).toHaveLength(2); // a casing and the line over it, the route being wholly solid
    for (const tag of [...lines, risk]) {
      expect(tag).not.toContain("vector-effect");
    }
    expect(widthOf(lines.find((tag) => tag.includes("stroke-ground"))!)).toBeCloseTo(5, 1);
    expect(widthOf(lines.find((tag) => tag.includes("stroke-brass"))!)).toBeCloseTo(3, 1);
    expect(widthOf(risk)).toBeCloseTo(2, 1);
  });

  it("keeps the hit layer and the rulers whatever the theme draws", () => {
    // Shared, and deliberately out of a theme's reach: a theme that drew nothing at all must still
    // leave the map clickable and readable.
    const svg = draw();

    expect(svg).toContain('aria-label="hex 1:7,53"');
    expect(svg).toContain('data-testid="map-ruler-x"');
  });
});
