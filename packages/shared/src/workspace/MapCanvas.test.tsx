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
 * nothing else checks it - the smoke suite exercises the map through Classic, which would go on
 * looking right if the contract quietly changed underneath it.
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

  it("keeps the hit layer and the rulers whatever the theme draws", () => {
    // Shared, and deliberately out of a theme's reach: a theme that drew nothing at all must still
    // leave the map clickable and readable.
    const svg = draw();

    expect(svg).toContain('aria-label="hex 1:7,53"');
    expect(svg).toContain('data-testid="map-ruler-x"');
  });
});
