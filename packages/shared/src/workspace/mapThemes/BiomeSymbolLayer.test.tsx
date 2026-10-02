import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BiomeSymbolDefs, BiomeSymbolLayer } from "./BiomeSymbolLayer";
import { biomeSymbolPlacements, SYMBOL_SPOTS, type MarkSpot } from "./biomeSymbols";
import type { HexView } from "./hexView";
import { aHexView } from "./hexViewFixture";
import { TERRAIN_KINDS } from "./terrain";

/**
 * The biome symbols as markup (ah-d9jb.4). Where they go is `biomeSymbols.ts`'s, and tested there;
 * what is checked here is that the layer draws what that rule says, with the shapes it should.
 */
function view(overrides: Partial<HexView> = {}): HexView {
  return aHexView(overrides);
}

const NOTHING: (view: HexView) => MarkSpot[] = () => [];

function draw(views: HexView[], footprint = NOTHING, pinned: ReadonlySet<string> = new Set()) {
  return renderToStaticMarkup(
    <svg>
      <BiomeSymbolLayer views={views} footprint={footprint} pinned={pinned} />
    </svg>
  );
}

describe("the biome symbols' shapes, in the map's defs", () => {
  it("defines one shape per biome, under an id the layer refers to", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <defs>
          <BiomeSymbolDefs />
        </defs>
      </svg>
    );

    for (const kind of TERRAIN_KINDS) {
      expect(markup, kind).toContain(`id="biome-symbol-${kind}"`);
    }
  });

  it("paints them in the plain ink of a printed map, with the spike's accents", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <BiomeSymbolDefs />
      </svg>
    );

    expect(markup).toContain("biome-symbol-paper");
    expect(markup).toContain("biome-symbol-lava");
    expect(markup).toContain("biome-symbol-cap");
    expect(markup).toContain("biome-symbol-crystal");
    expect(markup).toContain("biome-symbol-glow");
  });
});

describe("the biome symbol layer", () => {
  it("draws the hex's biome at every placement the rule gives", () => {
    const forest = view();
    const markup = draw([forest]);
    const uses = [...markup.matchAll(/<use [^>]*>/g)].map((match) => match[0]);

    expect(uses).toHaveLength(biomeSymbolPlacements(forest, []).length);
    for (const use of uses) {
      expect(use).toContain('href="#biome-symbol-forest"');
      expect(use).toContain('data-biome-symbol="forest"');
    }
  });

  it("is a decoration nothing can be clicked through", () => {
    const markup = draw([view()]);

    expect(markup).toContain('data-testid="biome-symbols"');
    expect(markup).toMatch(/data-testid="biome-symbols"[^>]*pointer-events="none"|pointer-events="none"[^>]*data-testid="biome-symbols"/);
  });

  it("fades a faded hex's symbols with it", () => {
    expect(draw([view({ fogOpacity: 0.4 })])).toContain('opacity="0.6"');
  });

  it("draws nothing in a hex whose terrain has no symbol", () => {
    expect(draw([view({ terrain: "lava", terrainKind: "other" })])).not.toContain("<use");
  });

  it("keeps clear of where the theme says its marks are", () => {
    const everywhere = () => SYMBOL_SPOTS.map(([x, y]) => ({ x, y, r: 0.2 }));

    expect(draw([view()], everywhere)).not.toContain("<use");
  });

  it("keeps clear of a note pinned on the hex", () => {
    const forest = view();
    const free = draw([forest]).match(/<use /g)?.length ?? 0;
    const pinned = draw([forest], NOTHING, new Set([forest.key])).match(/<use /g)?.length ?? 0;

    expect(pinned).toBe(biomeSymbolPlacements(forest, [{ x: 0.55, y: -0.55, r: 0.3 }]).length);
    expect(pinned).toBeLessThanOrEqual(free);
  });
});
