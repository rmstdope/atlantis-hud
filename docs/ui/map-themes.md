# Map Themes

How the world map's hex rendering is made pluggable, and how to add or remove a theme.

The design each theme implements is in [`hex-design-proposals.html`](hex-design-proposals.html);
the shared layers and the Classic theme's own vocabulary are in
[`hex-rendering.md`](hex-rendering.md).

## The split

**A theme decides *how* a hex is drawn. Shared code decides *what* there is to draw.**

Everything that is not paint stays in `MapCanvas.tsx` and is written once: hex geometry, the
unexplored lattice, panning and zooming, the route overlay and its risk tint, the selection and
keyboard focus rings, the hit and accessibility layer, and the rulers. A theme never sees a
`HexNode`, a settings store, or a layer toggle.

| Shared — `MapCanvas.tsx`                    | Theme                            |
| ------------------------------------------- | -------------------------------- |
| fog lattice, the twelve biome patterns      | terrain fill + texture treatment |
| route line, risk tint                       | knowledge / staleness overlays   |
| selection ring, focus ring                  | road spokes                      |
| hit + accessibility layer, rulers, pan/zoom | marks and labels                 |

Roads are the theme's because every design styles them differently, but they keep their own layer
*beneath* the route overlay, so a movement path crosses a road the way a traveller would.

## What a theme receives

`buildHexViews` (`mapThemes/hexView.ts`) turns the hexes of one knowledge bucket into `HexView`s.
It is pure, and it applies the layer chips **before** a theme sees anything — a view built with the
units chip off has no units in it at all, so a theme cannot forget to honour a toggle.

```ts
type HexView = {
  key: string;                      // regionId, and the React key
  at: { x: number; y: number };     // world position: a theme needs no geometry of its own
  terrain: string;
  texture: { url; patternId } | null;   // null when textures are off
  fogOpacity: number;               // age already resolved into a fade
  hatched: boolean;
  knowledge: HexKnowledge;
  ageInTurns: number | null;
  roads: RoadDirection[];           // [] when the structures chip is off
  settlement: { name: string; tier: "village" | "town" | "city" | null } | null;
  units: { own: number; foreign: number; monster: number };
  guard: "own" | "foreign" | null;
  ships: number; buildings: number; shafts: number; lairs: number;
  battle: boolean;                  // reserved, see below
  gate: boolean;                    // reserved, see below
};
```

**There are three knowledge states, not two, and a theme must decide what each looks like.**
`fogOpacity` is non-zero for *both* a hex known only from a neighbour's exits and a hex visited long
ago, so a theme that branches on it alone will draw them identically — and they mean opposite things.
A **named** hex was never visited and has no age: it is ground the survey never reached. A **stale**
hex is data you hold that may have gone out of date, and it is the one that carries `hatched`.
Branch on `knowledge`, and give the two different treatments. Cartographer's Table got this wrong
first time round and painted unvisited ground as an aged page.

And whatever tells the three states apart **must survive the far zoom band**, where every label is
hidden. Tactical HUD first distinguished "old reading" from "never surveyed" by a printed `T-` number
and nothing else, which meant it distinguished them only when zoomed in; it also used a fixed dim, so
a one-turn-old and a forty-turn-old reading were identical once the number went. Carry the
distinction in something the bands keep — the fade itself, an outline, a rim — and let the label
confirm it rather than carry it.

A related trap: if your theme damps the shared fade to keep terrain legible under ageing — most do —
make sure the damping applies to the **stale** case only. Ground nobody has visited has no terrain
worth keeping legible, and damping it makes the one state that should shout the quietest of the
three. Tactical HUD and Miniature World both did that at first.

While you are there: a fade meant to *hide* ground and a treatment meant to *age* it are not the same
strength. Laying a theme's own wash at the full `fogOpacity` buries the terrain, and every faded hex
comes out the same colour whatever it is made of — a stale ocean has to still read as ocean. Scale
it back and let the theme's own mark (hatching, a dashed rim, a T-minus number) carry the meaning.

Two fields are **reserved**: `battle` and `gate` are always `false`, because no parser reads them
yet. Every theme's layout keeps a slot for each anyway, so that when the data arrives the mark
appears without a layout change. `tier` is `null` for a hex known only from a neighbour's exits,
which gives the town's name but not its size — draw the unknown case rather than guessing a tier.

`units.foreign` is the whole foreign tally and `units.monster` says how many of those belong to the
monster faction, so a theme that does not draw monsters separately still shows everybody present.

## The theme contract

```ts
type MapTheme = {
  id: string;                       // stable: it is what gets persisted
  label: string;                    // what the settings picker shows
  Defs?: ComponentType;             // gradients, hatches, filters — optional
  TerrainLayer: ComponentType<LayerProps>;
  RoadLayer: ComponentType<LayerProps>;
  MarkLayer: ComponentType<LayerProps>;
};

type LayerProps = { views: HexView[] };
```

`TerrainLayer` is rendered three times, once per knowledge bucket, weakest knowledge first.
`RoadLayer` and `MarkLayer` are rendered once each over every hex on the level.

Two rules a theme may not break: **never import another theme**, and **never import the settings
store**. Everything a theme is allowed to know arrives in its `HexView`s, and the settings store
imports the registry in order to validate the persisted theme id — so a theme reaching back for a
setting closes that loop into an import cycle.

## Adding a theme

Four steps, and none of them touch `MapCanvas.tsx` or any other theme.

1. **Create the directory** `packages/shared/src/workspace/mapThemes/<yourTheme>/` holding:
   - `index.tsx` — the `MapTheme` object and its layer components
   - `paint.ts` — every layout and priority decision, as pure functions
   - `theme.css` — the theme's own colours and its zoom-band policy
   - `<yourTheme>.test.tsx` — pure tests over `paint.ts`, plus a render test
2. **Register it** — one entry in `MAP_THEMES` in `mapThemes/index.ts`.
3. **Import its stylesheet** — one `@import` line at the top of `packages/shared/src/theme.css`.
4. **Test it** — see below.

### Colours

Never a hex literal in `.ts`/`.tsx` — `theme.test.ts` fails the build on one, because a hard-coded
colour neither follows `data-theme` nor shows up in the parity check. Declare namespaced custom
properties in the theme's own `theme.css`, and give **every one of them** a light counterpart:

```css
:root {
  --ct-parchment: #efe3c2;
  --ct-ink: #4a3a22;
}
:root[data-theme="light"] {
  --ct-parchment: #fbf4e2;
  --ct-ink: #6b5836;
}
.ct-name {
  fill: var(--ct-ink);
}
```

`theme.test.ts` enforces the pairing, and also that the stylesheet is imported at all — a theme
whose CSS nobody imports renders unstyled, and nothing else would say so.

A theme happy with the app's terrain colours calls `terrainFillClass` from `mapHexView.ts` in its
own `TerrainLayer`, as Classic does.

### Zoom bands

The band policy is CSS, keyed on the root classes `map-far` / `map-mid` / `map-near` that
`MapCanvas` stamps, so changing band costs one class swap and no re-render.

**Scope every rule to your own theme.** All theme stylesheets are loaded whichever theme is
selected, so an unscoped rule goes on applying under themes that have never heard of yours — and
because the map's shared classes (`map-label`, `map-glyph`) are meant to be reused, an unscoped rule
of yours will hide another theme's labels. `MapCanvas` stamps `map-theme-<id>` on the same element
as the band class, so the two combine without a descendant space:

```css
.map-theme-tactical-hud.map-far .hud-badge,
.map-theme-tactical-hud.map-far .hud-number,
.map-theme-tactical-hud.map-mid .hud-number {
  display: none;
}
```

### Geometry

The design proposals are drawn at hex radius 46; the map runs at `HEX_RADIUS` 18. Take an anchor
from a mockup by dividing by 46 and express it as a fraction of the radius — `radii(0.6)` from
`mapThemes/geometry.ts` — tuning only where legibility at 18 demands it. The layout *rules* are the
contract, not the absolute pixel sizes.

By the map's convention, glyphs and pips scale with the world while labels stay screen-constant:
give a label the shared `map-label` class, which divides its font size by `--map-scale`, or divide by
it yourself if the theme wants its own type.

Two things worth copying from Cartographer's Table:

- **Draw the whole hex in the mockup's coordinates and scale it once.** That theme sets
  `SCALE = HEX_RADIUS / 46` and wraps each hex's marks in `scale(SCALE)`, so every number in the
  module can be read straight off the proposal and compared with it. Labels stay *outside* that
  group, because scaling text with the hex is the thing this map left a canvas to avoid.
- **Use `font-size` longhand, never the `font` shorthand.** A `calc()` inside the shorthand is valid
  CSS that some renderers drop, and a label that loses its `calc()` falls back to a default size
  several times the width of the hex. The desktop shell draws in whatever WebKit the system
  provides, so the map does not gamble on shorthand parsing.

### Testing

Vitest runs in plain node with no DOM, so render tests use `renderToStaticMarkup` from
`react-dom/server` — no new dependency, no environment switch:

```tsx
const views = buildHexViews(CONGESTED_HEXES, { showStaleness: true, showTextures: false,
                                               showUnits: true, showStructures: true });
const svg = renderToStaticMarkup(<svg><yourTheme.MarkLayer views={views} /></svg>);
expect(svg).toContain('data-chip="ship"');
```

`mapThemes/congestedFixture.ts` is the deliberately overloaded seven-hex neighbourhood the design
proposals were drawn over — a city with a battle, a guard, three unit groups, works, a ship and two
roads in one hex. Every theme is judged against it, because the real test of a hex design is not the
sparse hex but the full one. Put the characteristic decision (emblem priority, rail assignment, roof
cluster by tier) in `paint.ts` and test it as a pure function; use the render test to prove the
components actually emit what those decisions decided.

The registry suite renders every shipped theme over the fixture, so a theme that throws is caught
whether or not anyone wrote a test for it.

**Then look at it in the running app, not only in a fixture.** Every fault found in the first theme
was a visual one that a green suite said nothing about: a `calc()` dropped inside a `font` shorthand,
a wash that buried the terrain, unvisited ground drawn as an aged page. The fixture missed the last
two because it happens to contain one stale hex and no named one. Load a real report, switch to the
theme, and look at each knowledge state and both app themes before calling it done.

## Removing a theme

Delete the directory, its entry in `MAP_THEMES`, and its `@import` in `theme.css`. Nothing else
refers to it: anyone whose persisted setting named it falls back to Classic at startup, by
`knownMapTheme` in `settingsStore.ts`.

## Settings

`mapTheme` (a registry id) and `biomeTextures` live in `settingsStore.ts`, persist through the same
`localStorage` blob as every other preference, and apply to the open map immediately — the shell
resolves the id with `getMapTheme` on each render, so there is nothing to reload. An id the build
does not know falls back to Classic both when set and at startup, because storage is hand-editable
and a build can be downgraded past a theme it once shipped.

The settings picker reads its options from `mapThemeOptions()`, never from a list of its own, which
is what makes step 2 above sufficient.
