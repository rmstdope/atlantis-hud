# Hex Rendering Design

How a single hex on the world map is drawn. This is the graphical design contract for the map
widget; the implementation lives in `packages/shared/src/workspace/MapCanvas.tsx` (composition),
`packages/shared/src/workspace/mapHexView.ts` (paint decisions), and
`packages/shared/src/theme.css` (colors and zoom-band visibility).

## Foundations

- The map is **SVG**, not canvas. Text and strokes are re-rasterised at device resolution on
  every paint, so labels are sharp at every zoom.
- A hex is a **flat-top hexagon** of radius `HEX_RADIUS`, positioned on the lattice by
  column/row pitch. Corners sit at 60° intervals starting at 0°.
- **Every color is a theme class**, never an inline value. Each color is a CSS custom property
  with a dark and a light variant, so the whole map re-themes with one attribute swap. Classes
  are written out in full because Tailwind only generates utilities it has literally seen.
- **Screen-constant detail**: labels, strokes, pips, and glyphs keep the same on-screen size at
  every zoom. Fonts divide by `--map-scale`; strokes use `vector-effect: non-scaling-stroke`.

## Layer stack

A hex is composited from these layers, bottom to top:

1. Unexplored ground (fog)
2. Terrain fill / texture
3. Knowledge overlays (named fog, stale fade, stale hatch)
4. Road spokes
5. Route overlay (line + risk tint)
6. Marks: unit pips, unit count, structure glyphs, ship mark, settlement
7. Selection ring
8. Keyboard focus ring
9. Invisible hit/accessibility polygon

### 1. Unexplored ground

Unexplored positions have **no per-hex elements**. The whole unexplored world is one
full-viewport rectangle filled `terrain-unknown`, overlaid with a repeating SVG `<pattern>`
that draws the hex lattice edges in `fog-edge` at 1px screen-constant width. Each hex
contributes only its eastern three edges to the pattern motif, so no line is drawn twice.

### 2. Terrain

Every known hex is filled with a solid color keyed by terrain type: ocean, plain, forest,
mountain, swamp, desert, jungle, tundra, volcano, cavern, underforest, wasteland. Any terrain
word the parser meets that is not in this list falls back to `terrain-other` rather than
vanishing. The hex is outlined with a 1px screen-constant `map-edge` stroke.

When the **textures toggle** is on and the terrain has a texture, the flat fill is replaced by
a biome image (`/biomes/<terrain>_512.png`) clipped to the hex via an SVG pattern
(`preserveAspectRatio: slice`). The same twelve terrains are textured.

A **barren** hex — a region emptied by annihilation, where nothing lives and which cannot be
targeted again — gets its own terrain treatment, distinct from ordinary wasteland, so the scar
reads as what it is. *(Not yet implemented.)*

### 3. Knowledge

Hexes are drawn in three buckets, weakest knowledge first, so a fully-known hex always paints
on top: **named → stale → current**.

- **Named** (known only from a neighbour's exits): terrain overlaid with `terrain-unknown` fog
  at a fixed 55% opacity. Never hatched — a hex that was never visited has no age.
- **Current** (in this turn's report): terrain drawn clean, no overlay.
- **Stale** (visited before, absent from the current report), when the **staleness toggle** is
  on: terrain overlaid with fog whose opacity grows continuously with age —
  `min(0.62, 0.30 + 0.02 × ageInTurns)` — so a hex seen last turn reads nearly current and one
  seen twenty turns ago reads nearly a rumour. The cap keeps an old sighting distinguishable
  from ground nobody has walked. The hex is additionally hatched with a 45° diagonal line
  pattern (`ink-soft` at 22% opacity, 5px pitch) marking the data as held but possibly out of
  date. With the toggle off, stale hexes draw as current.

### 4. Roads

Shown when the **structures toggle** is on. A structure whose kind matches `road <direction>`
draws one **spoke**: a line from the hex centre to the matching edge midpoint, 0.87R along one
of the six bearings (n, ne, se, s, sw, nw). Spokes are 7px, round-capped, screen-constant, and
sit in a layer of their own *beneath* the route overlay, so a movement path crosses a road on
top of it and the wider road always peeks out from under the path's 5px casing.

### 5. Route overlay

When a route is being previewed or ordered, a polyline runs through the hex centres:

- **Solid** through the origin and every hex reached in the coming month.
- **Dotted** (6-6 dash) for the rest, joined seamlessly at the last solid hex. A unit of
  unknown speed gets an entirely dotted line.
- Both are `brass` at 3px over a 5px `ground` casing, screen-constant, so the line stays
  readable over any terrain.

Each hex the route **enters** (never the origin) is tinted with a risk overlay: hex fill at
28% opacity plus a 2px outline, in `risk-low` (blue), `risk-medium` (amber), or `risk-high`
(red).

### 6. Marks

All marks are `pointer-events: none` and gated by zoom band (see below).

- **Unit pips** (units toggle): up to three circles below centre, one per attitude group,
  colored by how the faction stands toward the units' owners rather than by mere ownership:
  own units and allies in green, friendly and neutral factions in blue, unfriendly and
  hostile factions in red. Radius encodes crowding: 2.6px for a handful (≤5), 4px for more.
  *(The current implementation still draws two pips, own/foreign — see "Design decisions not
  yet implemented" below.)*
- **Monster mark** (units toggle): a hex holding units belonging to faction 2 — the monster
  faction — carries a distinct monster mark, so wandering monsters are visible at a glance
  and never blend into the ordinary unit pips. *(Not yet implemented.)*
- **Battle mark**: a hex where a battle took place last turn is marked with crossing swords
  (⚔), so the month's fighting can be surveyed on the map without reading through the battle
  reports. *(Not yet implemented.)*
- **Shaft mark** (structures toggle): a hex containing a Shaft structure — a passage to
  another level — carries a distinct mark, the map's equivalent of stairs on a dungeon map.
  Shafts are the only non-magical way between the surface and the underworld, so they anchor
  all inter-level route planning. *(Not yet implemented.)*
- **Gate mark**: a hex known to contain a Gate carries a gate glyph. Gates allow instant
  travel via Gate Lore, so the set of known gates shapes mage logistics; they deserve to be
  visible without opening each region. *(Not yet implemented; may need parser support for
  the report's gate line.)*
- **Guard mark** (units toggle): a hex where units stand on guard carries a guard mark,
  colored by the same attitude groups as the unit pips — green when own or allied units hold
  the guard, red when unfriendly or hostile factions do. Guarding blocks taxation, theft and
  hostile movement, so "where am I on guard" and "who holds this city" should be answerable
  from the map alone. *(Not yet implemented.)*
- **Lair mark** (structures toggle): a hex containing a lair, cave, ruin or other
  unenterable monster habitat carries a hazard mark. These monsters never wander but can
  attack units in the hex — a standing danger distinct from the monster mark, which tracks
  faction 2 units. *(Not yet implemented.)*
- **Unit count** (units toggle): `own/foreign` text (the `/foreign` part omitted when zero),
  centred in the hex's upper third — a flat-top hex only reaches 0.87R up, so anything nearer
  the rim reads as the neighbour's. Pushed one step higher when a settlement name owns the
  slot above the glyph.
- **Structure glyphs** (structures toggle): ⌂ roofs in `brass`, cascading right-and-down from
  mid-right of the hex. Count encodes scale, not identity: 1 glyph for 1–3 buildings, 2 for
  4–6, 3 for 7 or more. Roads and ships are excluded from the building count.
- **Ship mark** (structures toggle): a small hull-with-sail path in `brass` at the hex's
  upper-left — something here can leave. A structure is a ship when its kind is one of the
  classic hull names (galley, raft, cog, clipper, galleon, corsair, balloon) or contains
  "ship" or "boat".
- **Settlement**: a glyph at centre with the settlement name tight above it, both in
  `settlement` color. Drawn last within the hex so name and glyph paint over roofs and hull.
  The glyph encodes the settlement's tier — village, town, or city — by size or variant, since
  the tiers differ hugely in market depth, recruitment, and guard strength. *(The current
  implementation draws a single ▣ for every tier — see "Design decisions not yet implemented"
  below.)*

Labels (`map-label`) are 9px screen-constant with a `ground`-colored halo stroke
(`paint-order: stroke fill`) so they stay legible over any terrain.

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
(`map-far` / `map-mid` / `map-near`) — changing band costs one class swap and no re-render.

| Element | far (step ≤ −3) | mid | near (step ≥ 3) |
|---|---|---|---|
| Terrain, knowledge overlays, roads, route | shown | shown | shown |
| Unit pips | hidden | shown | shown |
| Unit count text | hidden | hidden | shown |
| Structure glyphs, ship mark | hidden | shown | shown |
| Settlement glyph | hidden | shown | shown |
| Settlement name | hidden | hidden | shown |
| Selection / focus rings | shown | shown | shown |

The rationale: labels are drawn at constant screen size, so as hexes shrink the text does not —
past a point every label would overlap its neighbours.

## Color reference

All map colors, as theme custom properties (dark and light values in `theme.css`):

- `--color-terrain-<name>` — one per terrain, plus `terrain-unknown` (fog) and
  `terrain-other` (fallback)
- `--color-map-edge` — hex outline; `--color-fog-edge` — unexplored lattice
- `--color-unit-own`, `--color-unit-foreign` — unit pips and count (to become three
  attitude-group colors: green for own+allies, blue for friendly+neutral, red for
  unfriendly+hostile)
- `--color-settlement` — settlement glyph and name
- `--color-risk-low`, `--color-risk-medium`, `--color-risk-high` — route risk tints
- `brass` / `brass-bright` — route line, structure glyphs, selection and focus rings

Known exception: the road spoke is currently a literal `stroke="black"`, the one paint that
bypasses the theme system.

## Design decisions not yet implemented

The sections above describe the intended design; the implementation lags it in two places:

- **Attitude-colored unit pips.** The pips currently split units into own (blue) and foreign
  (red). The design calls for three groups keyed on the faction's attitude toward the units'
  owners: **own + allies (green)**, **friendly + neutral (blue)**, **unfriendly + hostile
  (red)**.
- **Monster mark.** Units of faction 2 (the monster faction) currently count as ordinary
  foreign units. The design calls for a distinct per-hex monster mark whenever faction 2 has
  units in the hex.
- **Battle mark.** Battles are currently invisible on the map. The design calls for crossing
  swords (⚔) on every hex where a battle took place last turn.
- **Shaft mark.** Shafts currently count among the ordinary building roofs. The design calls
  for a distinct passage-to-another-level mark.
- **Gate mark.** Gates are not surfaced at all; the report's gate line may need parser
  support before the mark can be drawn.
- **Guard mark.** The per-unit `onGuard` flag is parsed but never drawn. The design calls
  for a guard mark colored by attitude group.
- **Lair mark.** Lairs, caves and ruins currently count among the ordinary building roofs.
  The design calls for a distinct hazard mark.
- **Settlement tiers.** Every settlement currently gets the same ▣ glyph. The design calls
  for the glyph to encode village, town, or city.
- **Barren terrain.** Barren regions have no dedicated treatment; whatever terrain word the
  report uses falls through the ordinary terrain table.
