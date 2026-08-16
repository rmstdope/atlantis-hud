import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONGESTED_HEXES } from "./congestedFixture";
import { FADE_LIMIT, NAMED_FOG_OPACITY } from "../mapHexView";
import { HEX_RADIUS } from "../mapViewport";
import { allBadges, buildHexViews, dampFog, type HexView } from "./hexView";
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
  fogDamping: 1,
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

  it.each(MAP_THEMES.map((theme) => [theme.label, theme] as const))(
    "%s draws its roads through the shared road layer",
    (_label, theme) => {
      const svg = renderToStaticMarkup(
        <svg>
          <theme.RoadLayer views={views} />
        </svg>
      );

      expect(svg).toContain('data-layer="roads"');
      expect(svg).not.toContain("vector-effect");
      const widths = [...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((match) => Number(match[1]));
      expect(widths.length).toBeGreaterThan(0);
      for (const width of widths) {
        expect(width).toBeLessThan(HEX_RADIUS);
      }
    }
  );

  it.each(MAP_THEMES.map((theme) => [theme.label, theme] as const))(
    "%s declares a fog damping in (0, 1]",
    (_label, theme) => {
      expect(theme.fogDamping).toBeGreaterThan(0);
      expect(theme.fogDamping).toBeLessThanOrEqual(1);
    }
  );
});

/**
 * The one property the unsurveyed treatment rests on, checked across every theme at once.
 *
 * The fade stopped carrying the named/stale distinction when it was lightened to keep terrain
 * legible; the rim carries it now. But a theme that damps the *stale* wash and not the named one
 * lands them on top of each other again - Cartographer's Table did exactly that, at 0.400 against
 * an ancient sighting's 0.384, and told the two states apart by sixteen thousandths of an opacity.
 * Each theme's own suite tests its own wash, so nothing there could have seen it.
 *
 * The fade is damped once now, in `buildHexViews`, from the theme's own `fogDamping` - so a theme
 * can no longer damp one faded state and not the other, because a theme no longer damps at all.
 * This describe's job is now to see that no theme quietly reintroduces a private damping.
 */
describe("what every theme owes the three knowledge states", () => {
  /**
   * Each theme names its own washes - "unsurveyed" in most, "unpainted" on the board - so the
   * marks are given as alternatives rather than assumed to be one word.
   *
   * The whole tag is matched first and the opacity read out of it afterwards, so attribute order
   * does not matter. Reading them in one pass would have quietly stopped matching the day somebody
   * reordered two JSX props, and a registry-wide guard that silently finds nothing is worse than
   * no guard: `toBeDefined` below is what would fire, naming the wrong thing.
   */
  const opacitiesOf = (svg: string, marks: string): number[] =>
    Array.from(svg.matchAll(/<[a-z]+\s[^>]*>/gu))
      .map((match) => match[0])
      .filter((tag) => new RegExp(`data-(?:wash|dim)="(?:${marks})"`, "u").test(tag))
      .map((tag) => Number(/\sopacity="([\d.]+)"/u.exec(tag)?.[1]))
      .filter((opacity) => !Number.isNaN(opacity));

  const render = (theme: MapTheme, view: HexView) =>
    renderToStaticMarkup(
      <svg>
        <theme.TerrainLayer views={[view]} />
      </svg>
    );

  const [base] = buildHexViews(CONGESTED_HEXES, {
    showStaleness: true,
    showTextures: false,
    badges: allBadges(true)
  });

  it.each(MAP_THEMES.map((theme) => [theme.label, theme] as const))(
    "%s paints the fade it is handed, unchanged, for named and stale alike",
    (_label, theme) => {
      const named = render(theme, { ...base, knowledge: "named", fogOpacity: 0.5, hatched: false });
      const stale = render(theme, { ...base, knowledge: "stale", fogOpacity: 0.5, hatched: true });

      const [namedOpacity] = opacitiesOf(named, "unsurveyed|unpainted");
      const [staleOpacity] = opacitiesOf(stale, "stale");

      expect(namedOpacity).toBeCloseTo(0.5, 3);
      expect(staleOpacity).toBeCloseTo(0.5, 3);
    }
  );

  it.each(MAP_THEMES.map((theme) => [theme.label, theme] as const))(
    "%s keeps unsurveyed ground comfortably lighter than the oldest sighting",
    (_label, theme) => {
      const namedOpacity = dampFog(NAMED_FOG_OPACITY, theme.fogDamping);
      const staleOpacity = dampFog(FADE_LIMIT, theme.fogDamping);
      const named = render(theme, {
        ...base,
        knowledge: "named",
        fogOpacity: namedOpacity,
        hatched: false
      });
      const ancient = render(theme, {
        ...base,
        knowledge: "stale",
        fogOpacity: staleOpacity,
        hatched: true
      });

      // Comfortably apart, not merely ordered: two washes a hundredth apart are the same wash.
      expect(staleOpacity - namedOpacity).toBeGreaterThan(0.05);
      // And the mark that actually names the state, which the fade no longer does.
      expect(named).toContain('data-rim="unsurveyed"');
      expect(ancient).not.toContain('data-rim="unsurveyed"');
    }
  );
});
