# Map Themes

How the world map's hex rendering is made pluggable, and how to add or remove a theme.

The design each theme implements is in [`hex-design-proposals.html`](hex-design-proposals.html);
the shared layers, and the vocabulary every theme draws from, are in
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
*beneath* the route overlay, so a movement path crosses a road the way a traveller would. Give a
road its width in fractions of `HEX_RADIUS` — `radii(...)`, never `vector-effect` — so it shrinks
with the hex it belongs to; the route above it is drawn by the same rule.

## What a theme receives

`buildHexViews` (`mapThemes/hexView.ts`) turns the hexes of one knowledge bucket into `HexView`s.
It is pure, and it applies the badge toggles **before** a theme sees anything — a view built with
the own-units badge off has no own units in it at all, so a theme cannot forget to honour a toggle.

There is one toggle per mark, listed in `BADGES` (`mapThemes/hexView.ts`) and stored in the
workspace store: settlements, own units, foreign units, monsters, guard, ships, buildings, shafts,
lairs and roads. A theme neither reads them nor needs to know they exist — it draws exactly what the
view model says, and an unwanted mark simply is not in it.

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
  roads: RoadDirection[];           // [] when the roads badge is off
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
distinction in something the bands keep — an outline, a rim, a hatch — and let the label confirm it
rather than carry it.

**Not in the fade, though.** The fade is legibility, not meaning: `fogOpacity` for a named hex is
deliberately light (0.40, *below* the stale cap of 0.62), so unvisited ground reads lighter than an
old sighting. Every theme therefore draws an **unsurveyed rim** on a named hex — `data-rim`, in its
own colours and dash — and that is what the distinction rests on. This is the reverse of what the
guidance here said for a while: the named fade used to run at 0.78 so that the wash alone would
separate the two, and at that strength a named forest and a named desert were the same pale smudge.
Terrain is the one fact a named hex carries, and the map was throwing it away to make a point the
rim makes better.

The same reasoning is why a theme damps the shared fade before painting with it, and it applies to
**both** faded states: a fade meant to *hide* ground and a treatment meant to *age* or *reserve* it
are not the same strength. Laying a theme's own wash at the full `fogOpacity` buries the terrain,
and every faded hex comes out the same colour whatever it is made of — a stale ocean has to still
read as ocean, and so does a named one. Scale it back and let the theme's own mark (hatching, a
dashed rim, a T-minus number) carry the meaning.

Damp them by the **same factor**, and check what the two land on. Every theme here damped stale and
left named whole, from the days when named was the heavy one — which after the fade was lightened
put unsurveyed ground on top of a long-stale wash instead of clear of it. Cartographer's Table came
out at 0.400 against 0.384, sixteen thousandths apart, and Emblem & Dots and Beveled Tile were not
much better. `mapThemes/index.test.tsx` now checks the gap for every registered theme at once,
because each theme's own suite only ever sees its own numbers and none of them could see this.

And do not withhold the terrain paint itself from a named hex. Miniature World did, leaving bare
board — defensible about the *scenery* a modeller adds having been there, which it still withholds,
but not about the ground: a neighbour naming the hex says what terrain is there. Paint it, then say
"nobody has been here" over the top.

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
own `TerrainLayer` rather than declaring a palette of its own. Every theme that ships does declare
one, so this is an offer rather than a description.

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

A **stroke's width** is the exception that needs deciding rather than copying, because
`vector-effect: non-scaling-stroke` is the map's habit and most of a theme's strokes keep it. The
line: a mark that stands for something *on the ground* and spans a hex — a road, and the route
above it — is measured in the hex's own units both along and across, so it shrinks with the map.
The outlines of glyphs, pips, chips and rims are ink on a mark rather than the mark itself, and
stay screen-constant like the labels. Roads were on the wrong side of that line until ah-ebv, and
grew wider than their own hexes at far zoom.

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
                                               badges: allBadges(true) });
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

**A fixture that lacks a dimension cannot test that dimension, however hard you look at it.** This is
the trap behind most of the faults in this epic, and staring harder does not help:

- `congestedFixture.ts` holds no **named** hex, so nothing built on it can show what unsurveyed
  ground looks like. That is how a wash meant for aged pages got applied to unvisited ground.
- Rendering the knowledge states with textures **off** cannot show what they look like with textures
  **on**, and the reverse is just as blind: a textured hex draws no scenery whatever its knowledge,
  so a "withholds the scenery" check written with textures on passes against a theme that withholds
  nothing. Pick the mode in which the behaviour under test can actually differ, and say why.

So: render the knowledge states in both texture modes, and when a check comes back clean, ask what
the input could not have expressed rather than what it proved.

**Scope a class assertion to the element under test.** A hex contains unit marks, guard marks and
settlement marks that share the same group classes, so `expect(svg).toContain("ct-fill-foreign")`
passes whatever the guard is painted. Two tests written exactly that way passed against the bug they
were written to catch. Match the element first (`data-scene="guard"`), then assert inside it — and
mutation-check anything asserting a colour or a class by reverting the fix and watching it fail.

## Removing a theme

Delete the directory, its entry in `MAP_THEMES`, and its `@import` in `theme.css`. Nothing else
refers to it by name: anyone whose persisted setting named it lands on `DEFAULT_MAP_THEME_ID`
instead, by `knownMapTheme` in `settingsStore.ts`.

**Removing the *default* is the case that needs care**, because two things name it outside the
registry list: `DEFAULT_MAP_THEME_ID` itself, and the hard-coded last resort inside `getMapTheme`
that keeps the signature's promise for a caller passing an empty registry. Move both before
deleting the directory, or the build fails on an import that no longer resolves.

Check what the theme was the last user of, too — nothing reports this, and removing Classic
orphaned more than it looked like it would: the shared `#stale-hatch` pattern in `MapCanvas.tsx`,
`unitPipRadius` in `mapHexView.ts`, and three fields of `HexPaint` that were being computed for
every hex on every render with no remaining reader. Those were deleted with the theme.

The shared **palette** was left standing on purpose, and it is the distinction worth drawing: the
twelve `--color-terrain-*` properties, `--color-map-edge`, `--color-unit-*`, `--color-settlement`
and the `.map-label` class are now used by nothing, but they are the offer this document makes to
the next theme, not leftovers. Dead code goes; an unused offer stays, and says so.

## Settings

`mapTheme` (a registry id) and `biomeTextures` live in `settingsStore.ts`, persist through the same
`localStorage` blob as every other preference, and apply to the open map immediately — the shell
resolves the id with `getMapTheme` on each render, so there is nothing to reload. An id the build
does not know falls back to `DEFAULT_MAP_THEME_ID`, because storage is hand-editable and a build
can be downgraded past a theme it once shipped.

That fallback happens at **two** separate doors, and the startup one is easy to miss: `setMapTheme`
runs the id through `knownMapTheme`, but rehydration merges the stored blob straight into state
without ever reaching the setter. What reconciles a returning player's blob is
`applyPersistedSettings`, alongside the same reconciliation every other hand-editable setting gets.
A test that only calls `persist.rehydrate()` is not testing the app's startup path.

The settings picker reads its options from `mapThemeOptions()`, never from a list of its own, which
is what makes step 2 above sufficient.
