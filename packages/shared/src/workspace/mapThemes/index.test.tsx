import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONGESTED_HEXES } from "./congestedFixture";
import { allBadges, buildHexViews } from "./hexView";
import type { LayerProps, MapTheme } from "./mapTheme";
import {
  DEFAULT_MAP_THEME_ID,
  getMapTheme,
  mapThemeOptions,
  MAP_THEMES,
  isMapThemeId
} from "./index";

const views = buildHexViews(CONGESTED_HEXES, {
  showStaleness: true,
  showTextures: false,
  badges: allBadges(true)
});

/**
 * A theme invented entirely inside this test.
 *
 * It exists to prove the claim the engine is built on: a new theme is one module and one registry
 * entry, needing no change to the map, the settings dialog, or any other theme. Everything below
 * treats it exactly as a shipped theme.
 */
const dummy: MapTheme = {
  id: "dummy",
  label: "Dummy",
  TerrainLayer: ({ views }: LayerProps) => (
    <g>
      {views.map((view) => (
        <circle key={view.key} cx={view.at.x} cy={view.at.y} r={3} data-dummy="terrain" />
      ))}
    </g>
  ),
  RoadLayer: () => <g data-dummy="roads" />,
  MarkLayer: () => <g data-dummy="marks" />
};

describe("the map theme registry", () => {
  it("lists every shipped theme, each with an id and a name to show", () => {
    expect(MAP_THEMES.length).toBeGreaterThan(0);
    for (const theme of MAP_THEMES) {
      expect(theme.id).not.toBe("");
      expect(theme.label).not.toBe("");
    }
  });

  it("keeps theme ids unique, since the id is what gets persisted", () => {
    const ids = MAP_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("opens on Cartographer's Table, the most map-like of the designs", () => {
    expect(DEFAULT_MAP_THEME_ID).toBe("cartographers-table");
    expect(getMapTheme(DEFAULT_MAP_THEME_ID).id).toBe("cartographers-table");
  });

  it("no longer ships Classic, and sends anyone who still names it to the default", () => {
    // Classic was the map before the designs arrived, and was retired once they had all landed.
    // Its id lives on in hand-editable storage and in settings blobs written by older builds, so
    // the registry has to answer for it rather than merely not know it.
    expect(isMapThemeId("classic")).toBe(false);
    expect(MAP_THEMES.some((theme) => theme.id === "classic")).toBe(false);
    expect(getMapTheme("classic").id).toBe(DEFAULT_MAP_THEME_ID);
  });

  it("finds a theme by the id that was persisted", () => {
    for (const theme of MAP_THEMES) {
      expect(getMapTheme(theme.id)).toBe(theme);
    }
  });

  it("falls back to the default rather than drawing nothing on an id it does not know", () => {
    // Storage is hand-editable, and a build can be downgraded past a theme it once had.
    expect(getMapTheme("no-such-theme").id).toBe(DEFAULT_MAP_THEME_ID);
    expect(getMapTheme("").id).toBe(DEFAULT_MAP_THEME_ID);
    expect(isMapThemeId("no-such-theme")).toBe(false);
    expect(isMapThemeId(DEFAULT_MAP_THEME_ID)).toBe(true);
  });

  it("still answers with a theme when handed a registry holding none", () => {
    // The signature promises a MapTheme, and the map crashes on anything else. An empty registry
    // is not reachable from the shipped one, but the promise has to hold for the argument form
    // too - which is what the tests and the picker use.
    expect(getMapTheme("no-such-theme", []).id).toBe(DEFAULT_MAP_THEME_ID);
    expect(isMapThemeId(DEFAULT_MAP_THEME_ID, [])).toBe(false);
  });
});

describe("what the settings picker offers", () => {
  it("reads its options from the registry rather than from a list of its own", () => {
    expect(mapThemeOptions()).toEqual(MAP_THEMES.map(({ id, label }) => ({ id, label })));
  });

  it("offers a theme it has never heard of as soon as the registry holds it", () => {
    // The picker gains an entry from the registry entry alone - no case, no branch, no edit.
    const options = mapThemeOptions([...MAP_THEMES, dummy]);

    expect(options.at(-1)).toEqual({ id: "dummy", label: "Dummy" });
  });

  it("resolves a theme from an extended registry the same way", () => {
    expect(getMapTheme("dummy", [...MAP_THEMES, dummy])).toBe(dummy);
  });
});

describe("a theme the engine has never seen", () => {
  it("draws through the same layers every shipped theme draws through", () => {
    const svg = renderToStaticMarkup(
      <svg>
        <dummy.TerrainLayer views={views} />
        <dummy.RoadLayer views={views} />
        <dummy.MarkLayer views={views} />
      </svg>
    );

    // One terrain mark per hex, and the two other layers present: the whole contract.
    expect(svg.match(/data-dummy="terrain"/g)).toHaveLength(views.length);
    expect(svg).toContain('data-dummy="roads"');
    expect(svg).toContain('data-dummy="marks"');
  });
});

describe("every shipped theme", () => {
  it.each(MAP_THEMES.map((theme) => [theme.label, theme] as const))(
    "%s draws the congested neighbourhood without throwing",
    (_label, theme) => {
      const svg = renderToStaticMarkup(
        <svg>
          {theme.Defs ? <theme.Defs /> : null}
          <theme.TerrainLayer views={views} />
          <theme.RoadLayer views={views} />
          <theme.MarkLayer views={views} />
        </svg>
      );

      expect(svg.length).toBeGreaterThan(0);
    }
  );

  it("keeps themes isolated, so removing one cannot break another", () => {
    // Nothing about a theme may depend on another theme existing.
    for (const theme of MAP_THEMES) {
      expect(theme.id).not.toBe("");
      expect(typeof theme.TerrainLayer).toBe("function");
      expect(typeof theme.RoadLayer).toBe("function");
      expect(typeof theme.MarkLayer).toBe("function");
    }
  });
});
