# Hex Rendering Design

How a single hex on the world map is drawn. This is the graphical design contract for the map
widget; the implementation lives in `packages/shared/src/workspace/MapCanvas.tsx` (composition),
`packages/shared/src/workspace/mapHexView.ts` (shared geometry and terrain decisions), and
`packages/shared/src/theme.css` (colors).

> **Hex rendering is pluggable.** The layers described below are split between the map, which owns
> some of them once for everybody, and the selected *map theme*, which owns terrain, knowledge
> overlays, roads and marks. This document describes the **contract**: what there is to draw, and
> what each layer means. Where a concrete treatment helps, it is taken from **Cartographer's
> Table**, the theme the map opens on — but a theme is free to draw the same meaning differently,
> and the five that ship all do. What a theme receives, and how to add one, is in
> [`map-themes.md`](map-themes.md); the designs are drawn in
> [`hex-design-proposals.html`](hex-design-proposals.html).
>
> Settlement tiers, guards, monsters, shafts and lairs are all derived from what reports already
> provide, and every shipped theme draws them. The "not yet implemented" list at the foot of this
> document is therefore about the parser and the view model rather than about any one theme:
> **battle** and **gate** await parser work, attitude groups await faction attitudes, and barren
> terrain awaits a decision about how to draw it.

## Foundations

- The map is **SVG**, not canvas. Text and strokes are re-rasterised at device resolution on
  every paint, so labels are sharp at every zoom.
- A hex is a **flat-top hexagon** of radius `HEX_RADIUS`, positioned on the lattice by
  column/row pitch. Corners sit at 60° intervals starting at 0°.
- **Every color is a theme class**, never an inline value. Each color is a CSS custom property
  with a dark and a light variant, so the whole map re-themes with one attribute swap. Classes
  are written out in full because Tailwind only generates utilities it has literally seen.
- **Screen-constant detail**: labels, the fog hairline, and the *stroke weights* of pips, glyphs
  and the selection and focus rings keep the same on-screen size at every zoom. Fonts divide by
  `--map-scale`; strokes use `vector-effect: non-scaling-stroke`. Their **positions and sizes**
  still scale with the world — it is the ink that is held constant, not the mark.
- **Hex-relative marks**: a mark that belongs to the ground rather than to the reader — a road,
  the route across it, the risk outline on a hex — takes its width in fractions of `HEX_RADIUS`
  too, so it shrinks with the hex it belongs to. Roads were screen-constant until ah-ebv, which at
  minimum zoom made a 5px-wide road out of a 3.9px-long spoke.

## Layer stack

A hex is composited from these layers, bottom to top:

1. Unexplored ground (fog)
2. Terrain fill / texture
3. Knowledge overlays (named fog, stale fade, stale hatch)
4. Road spokes
5. Route overlay (line + risk tint)
6. Marks: units, unit count, guard, monsters, buildings, ships, shafts, lairs, settlement
7. Selection ring
8. Keyboard focus ring
9. Invisible hit/accessibility polygon

### 1. Unexplored ground

Unexplored positions have **no per-hex elements**. The whole unexplored world is one
full-viewport rectangle filled `terrain-unknown`, overlaid with a repeating SVG `<pattern>`
that draws the hex lattice edges in `fog-edge` at 1px screen-constant width. Each hex
contributes only its eastern three edges to the pattern motif, so no line is drawn twice.

### 2. Terrain

Every known hex is painted by terrain type, keyed on twelve terrains: ocean, plain, forest,
mountain, swamp, desert, jungle, tundra, volcano, cavern, underforest, wasteland. Any terrain
word the parser meets that is not in this list falls back to an "other" treatment rather than
vanishing.

*How* a terrain is painted is the theme's. The shared palette — one `--color-terrain-<name>` per
terrain, applied through `terrainFillClass` — is available to a theme that wants it, but every
theme that ships declares its own: Cartographer's Table paints tinted paper and outlines the hex in
ink, Miniature World paints a lit/shade gradient pair, Tactical HUD a panel wash.

When the **textures toggle** is on and the terrain has a texture, the flat fill is replaced by
a biome image (`/biomes/<terrain>_512.png`) clipped to the hex via an SVG pattern
(`preserveAspectRatio: slice`). The same twelve terrains are textured.

A **barren** hex — a region emptied by annihilation, where nothing lives and which cannot be
targeted again — gets its own terrain treatment, distinct from ordinary wasteland, so the scar
reads as what it is. *(Not yet implemented.)*

### 3. Knowledge

Hexes are drawn in three buckets, weakest knowledge first, so a fully-known hex always paints
on top: **named → stale → current**.

The **fade** each bucket gets is decided once, in `hexPaint`, and handed to the theme as a
`fogOpacity`; what that fade is painted *in*, and what else marks the state, is the theme's.

- **Named** (known only from a neighbour's exits): faded at a fixed 40%, never hatched — a hex that
  was never visited has no age — and **rimmed**. The fade is light on purpose: a neighbour's exits
  still say what terrain is there, and that is the one fact the hex carries, so burying it under a
  heavy wash threw away the only thing worth drawing. What says *unsurveyed* is the rim, which every
  theme draws in its own vocabulary and which the far zoom band keeps. Themes carry it further from
  there — Cartographer's Table washes a cool unsurveyed grey under a pencilled boundary rather than
  the warm tone of age, Tactical HUD outlines an unconfirmed contact, Miniature World primes the
  board in the terrain's colours and tapes its edge, still visibly unfinished.

  **This is below the stale cap, so unvisited ground reads *lighter* than an old sighting.** That
  inverts what the fade used to say and is deliberate: the fade is legibility now, and the rim and
  the hatch are what carry meaning. It was the other way round until the heavy wash was found to
  make a named forest and a named desert the same pale smudge.

  These are the figures the *view model* hands over. Each theme damps them by its own factor before
  painting — see [`map-themes.md`](map-themes.md) — so the numbers on screen are lower, and it is
  the damped pair that has to stay clearly apart.
- **Current** (in this turn's report): terrain drawn clean, no overlay.
- **Stale** (visited before, absent from the current report), when the **staleness toggle** is
  on: faded continuously with age — `min(0.62, 0.30 + 0.02 × ageInTurns)` — so a hex seen last turn
  reads nearly current and one seen twenty turns ago reads nearly a rumour. The cap keeps an old
  sighting distinguishable from ground nobody has walked. A theme marks the data as held but
  possibly out of date on top of the fade, typically by hatching the hex; each declares its own
  hatch. With the toggle off, stale hexes draw as current.

Two traps live here, both of which have caught a theme already, and both are stated at length for
theme authors in [`map-themes.md`](map-themes.md): a theme that branches on `fogOpacity` alone
draws named and stale identically though they mean opposite things, and whatever tells them apart
has to survive the far zoom band, where every label is hidden.

### 4. Roads

Shown when the **roads badge** is on. A structure whose kind matches `road <direction>` draws one
**spoke**: a line from the hex centre to the matching edge midpoint, 0.87R along one of the six
bearings (n, ne, se, s, sw, nw). The bearing and the length are shared; the weight and the style
are the theme's, and they differ by design — Tactical HUD draws the thinnest road, Miniature World
the heaviest.

A road's **width is a fraction of `HEX_RADIUS`**, like its length, so it shrinks with the map. It
has to be: a width in screen pixels stays put while the hex shrinks under it, and at minimum zoom
(scale 0.25) a hex is 9px across and a spoke 3.9px long, so a 5px road stops being a line and
becomes a blob over its own hex — worst
of all in the far band, which hides the labels and pips and keeps the roads.

Roads sit in a layer of their own *beneath* the route overlay, so a movement path crosses a road
the way a traveller would. The route is measured the same way for the same reason, so a road still
peeks out from under the path's casing at every zoom and "does this route run along the road or
miss it" stays legible.

### 5. Route overlay

When a route is being previewed or ordered, a polyline runs through the hex centres:

- **Solid** through the origin and every hex reached in the coming month.
- **Dotted** (6-6 dash) for the rest, joined seamlessly at the last solid hex. A unit of
  unknown speed gets an entirely dotted line.
- Both are `brass` over a `ground` casing, so the line stays readable over any terrain. The two
  weights are fractions of `HEX_RADIUS` — 3 and 5 units, which is 3px over 5px at rest — and they
  scale with the map like the roads beneath them (ah-ebv).

Each hex the route **enters** (never the origin) is tinted with a risk overlay: hex fill at
28% opacity plus a 2-unit outline, in `risk-low` (blue), `risk-medium` (amber), or `risk-high`
(red). The outline scales with the hex it is drawn on; the selection and focus rings on that same
hexagon are chrome rather than ground and stay screen-constant.

### 6. Marks

All marks are `pointer-events: none` and gated by zoom band (see below). Each is switchable on its
own, by the badge named in brackets; the toggles are applied in `buildHexViews` *before* a theme
sees anything, so a mark the player turned off is not in the view model at all. What each mark
**means** is below; what it looks like is the theme's, and no two themes draw them alike.

- **Unit marks** (own units / foreign units): how many units stand in the hex and whose they are.
  Crowding is encoded as well as presence — a hex holding twenty units should not read as a hex
  holding one. *(The view model splits units own/foreign/monster; the design calls for three
  **attitude** groups instead — see "not yet implemented" below.)*
- **Unit count** (own units / foreign units): the tally as text, for the near band where there is
  room for it. How it is broken up is the theme's — one number per group beside each mark, rather
  than a single combined figure, in every theme that ships.
- **Monster mark** (monsters): a hex holding units of faction 2 — the monster faction — carries a
  mark of its own, so wandering monsters never blend into somebody's army.
- **Guard mark** (guard): units standing on guard, and whose. Guarding blocks taxation, theft and
  hostile movement, so "where am I on guard" and "who holds this city" are answerable from the map
  alone.
- **Settlement** (settlements): the settlement's name, and a glyph encoding its tier — village,
  town or city — since the tiers differ hugely in market depth, recruitment and guard strength.
  The tier is `null` for a hex named only by a neighbour's exits, which gives the name but not the
  size; that case is drawn as unknown rather than guessed at.
- **Building marks** (buildings): how much has been built here. Count encodes scale, not identity.
  Roads, ships, shafts and lairs are each classified out of the building tally and carry their own
  marks.
- **Ship mark** (ships): something here can leave. A structure is a ship when its kind is one of
  the classic hull names (galley, raft, cog, clipper, galleon, corsair, balloon) or contains
  "ship" or "boat".
- **Shaft mark** (shafts): a passage to another level — the map's equivalent of stairs on a dungeon
  map. Shafts are the only non-magical way between the surface and the underworld, so they anchor
  all inter-level route planning.
- **Lair mark** (lairs): a lair, cave, ruin or other unenterable monster habitat. These monsters
  never wander but can attack units in the hex — a standing danger, distinct from the monster mark,
  which tracks faction 2's roaming units.
- **Battle mark**: a hex where a battle took place last turn, so the month's fighting can be
  surveyed without reading through the battle reports. *(Reserved: every theme keeps a slot for it,
  and the field is always false until the parser reads it.)*
- **Gate mark**: a hex known to contain a Gate. Gates allow instant travel via Gate Lore, so the
  set of known gates shapes mage logistics. *(Reserved, as above; may need parser support for the
  report's gate line.)*

Labels must stay screen-constant, dividing their font size by `--map-scale`, or they grow with the
hex and the map is back to what it left a canvas to avoid. The shared `map-label` class does that
at 9px with a `ground`-colored halo stroke (`paint-order: stroke fill`) and is there for the
taking; every theme that ships sets its own type instead, dividing by `--map-scale` itself — as
Cartographer's Table does with an italic serif.

### 7–8. Selection and focus rings

- **Selection ring**: the selected hex is outlined in `brass`, 2.5px screen-constant, solid,
  no fill.
- **Keyboard focus ring**: where the map cursor stands, outlined in `brass-bright`, 2px,
  **dashed** (4-3) so the two rings are never confused. Shown only while the map actually
  holds focus. The cursor may stand on unexplored ground, where the ring is the only thing
  drawn.

### 9. Hit and accessibility layer

Topmost, flat, and invisible: one polygon per hex acting as a button (roving tabindex,
`aria-label`, `<title>` tooltip). It paints nothing — keeping it separate from the terrain
buckets means a hex whose knowledge changes is not remounted, so it cannot lose focus
mid-keystroke.

## Zoom bands

How much a hex shows depends on the zoom band, expressed as CSS rules keyed on a root class
(`map-far` / `map-mid` / `map-near`) — changing band costs one class swap and no re-render. The
map stamps the band; each theme writes its own policy, scoped to its own `map-theme-<id>` class.

The shared shape of that policy, which every theme follows in its own vocabulary:

| Element | far (step ≤ −3) | mid | near (step ≥ 3) |
|---|---|---|---|
| Terrain, knowledge overlays, roads, route | shown | shown | shown |
| Unit marks | hidden | shown | shown |
| Unit count text | hidden | hidden | shown |
| Building and ship marks | hidden | shown | shown |
| Settlement glyph | hidden | shown | shown |
| Settlement name | hidden | hidden | shown |
| Selection / focus rings | shown | shown | shown |

The rationale: labels are drawn at constant screen size, so as hexes shrink the text does not —
past a point every label would overlap its neighbours. Which is also why anything carrying
*meaning* has to survive the far band without a label to lean on.

## Color reference

Custom properties in `theme.css`, each with a dark and a light value. **What the map itself still
draws with**, and so what a change here actually repaints:

- `--color-terrain-unknown` — the unexplored ground; `--color-fog-edge` — the lattice over it
- `--color-risk-low`, `--color-risk-medium`, `--color-risk-high` — route risk tints
- `brass` / `brass-bright` — route line, selection and focus rings

**Offered, but drawn with by nothing at present**: one `--color-terrain-<name>` per terrain plus
`terrain-other`, reached through `terrainFillClass`; `--color-map-edge`; `--color-unit-own` and
`--color-unit-foreign` (to become three attitude-group colors — green for own+allies, blue for
friendly+neutral, red for unfriendly+hostile); `--color-settlement`. They were the palette of the
retired Classic theme, and they remain the shared palette a new theme may adopt rather than
declaring one of its own. Every theme that ships declares its own.

A theme's own properties are namespaced and live in its `theme.css`; `theme.test.ts` requires a
light counterpart for each and fails the build on a hex literal in `.ts`/`.tsx`.

## Design decisions not yet implemented

The sections above describe the intended design. What is still missing is missing from the **view
model or the parser**, not from any one theme — a mark the view model carries, every shipped theme
draws.

- **Attitude-colored unit marks.** The view model splits units into own, foreign and monster. The
  design calls for three groups keyed on the faction's attitude toward the units' owners:
  **own + allies (green)**, **friendly + neutral (blue)**, **unfriendly + hostile (red)**. This
  awaits faction attitudes being parsed and carried through.
- **Battle mark.** `battle` is a reserved field on `HexView` and is always false; the parser does
  not read last turn's battles yet. Every theme keeps a slot for the mark, so nothing but the data
  is missing.
- **Gate mark.** `gate` is reserved the same way. The report's gate line may need parser support
  before the field can ever be true.
- **Barren terrain.** A region emptied by annihilation has no dedicated treatment; whatever terrain
  word the report uses falls through the ordinary terrain table.
