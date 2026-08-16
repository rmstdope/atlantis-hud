# Field Marks - icon brief

`Field Marks (image icons)` is a new map theme, selectable in **Settings → Global → map theme**
alongside the five shipped designs. It draws the same terrain and roads as Cartographer's Table,
but every settlement, unit group, guard, monster, shaft, lair and ship is an external image file
instead of a hand-drawn shape - the eleven files below.

Nothing else changes: the four other themes are untouched, and this one is just another item in
the picker. Select it once files start arriving to see how they look; leave anything out and that
mark simply draws nothing on the hex, never a broken-image glyph.

## Where files go

`config/public/badges/<filename>.svg` - served at `/badges/<filename>.svg`. The exact filenames
are fixed in code (`packages/shared/src/workspace/mapThemes/fieldMarks/badges.ts`, the
`BADGE_SPECS` map) - a file has to be named precisely as listed below or the theme will not find it.

## Format

**SVG**, not PNG or JPEG. The map is drawn as SVG and zooms over a wide range - a raster icon would
blur or pixelate well before a vector one would. Each file's own `viewBox` can be whatever square
you draw in (`0 0 64 64` is a reasonable default); the app scales the whole file to fit the size
listed for it, so the internal coordinate system does not need to match anything else.

Draw the glyph filling most of its square, with a small margin - the same convention as an app
icon. A shape that touches the edges reads as cramped once scaled down to the size it is actually
shown at on the hex.

## Colour

Nine of the eleven files are drawn in whatever single ink colour you like - a dark, saturated line
or fill reads best against the parchment terrain underneath, in the spirit of the other themes'
line art. These nine do **not** need to match a specific hex value.

**Five files are the exception and must be pre-coloured exactly as given below.** Colour is how the
map tells "yours" from "somebody else's" apart, and this theme has no code-side tinting - the file
itself carries the colour, so `unit-own.svg` and `unit-foreign.svg` need to be the same shape in two
different files, not one file swapped by CSS:

| File               | Colour    |
| ------------------- | --------- |
| `guard-own.svg`     | `#4caf7d` (green) |
| `guard-foreign.svg` | `#5ec8f0` (blue) |
| `unit-own.svg`      | `#4caf7d` (green) |
| `unit-foreign.svg`  | `#5ec8f0` (blue) |
| `unit-monster.svg`  | `#f07070` (red) |

These are the same three colours the other themes already use for own/foreign/monster, so a hex
carrying both a guard banner and a unit shield in this theme reads the same allegiance at a glance
as it would in any other.

One limitation worth knowing: the app has a separate light/dark interface theme, and these five
colours are fixed regardless of which one is active. If that turns out to matter once you see it
in place, it is solvable later (two colour variants per file, or a masking technique instead of
flat colour) - just not the first-pass plan.

## The eleven files

| # | File | Size* | What it is |
|---|------|------|------------|
| 1 | `settlement-house.svg` | 16 | A village's or town's settlement. Drawn once for a village, twice side by side for a town, and reused smaller for a workshop band - one file covers all three. |
| 2 | `settlement-keep.svg` | 34 | A city's settlement - towers, walls, something that reads as fortified. The one tier with its own icon. |
| 3 | `guard-own.svg` | 20 | A banner or shield for a guard order held by this faction. **Colour: `#4caf7d`.** |
| 4 | `guard-foreign.svg` | 20 | The same mark for a guard held by anybody else. **Colour: `#5ec8f0`.** |
| 5 | `monster.svg` | 14 | A claw mark, a paw print, anything that reads "something wild is here" at a glance - a presence marker, not a specific creature. |
| 6 | `shaft.svg` | 16 | A shaft down to the underworld - a ladder, a hole, a mine-shaft silhouette. |
| 7 | `lair.svg` | 16 | A monster lair - a cave mouth, a dark opening. |
| 8 | `ship.svg` | 22 | A harbour with something afloat - a simple sail or hull silhouette. |
| 9 | `unit-own.svg` | 12 | A small shield or emblem for this faction's own units, sitting under a printed count. **Colour: `#4caf7d`.** |
| 10 | `unit-foreign.svg` | 12 | The same shield for another faction's units. **Colour: `#5ec8f0`.** |
| 11 | `unit-monster.svg` | 12 | The same shield again for a monster faction's units. **Colour: `#f07070`.** |

\* Size is the square the icon is drawn into, in the map's own internal units at the default zoom -
not pixels on screen, since the whole hex scales with the map. Treat it as a *relative* size: item
2 (the keep) should read as roughly twice the width of item 9 (a unit shield), item 3/4 (guard)
somewhat larger than item 9 again, and so on down the table. Exact pixel-perfect matching to these
numbers is not necessary - the app clamps every file to its own square regardless of what the file's
internal `viewBox` says, so a shape drawn too large or small inside its own square will still fit,
just proportioned differently than intended.

## What is deliberately not on this list

**Gate** and **battle** marks are not included. Both exist in the underlying data model but nothing
in the report parser sets them yet - they are reserved for later - so an icon for either would
never actually be drawn. If that changes, two more files (and two more rows in `BADGE_SPECS`) would
extend the same manifest.

**Roads** are not image-based in this theme - they are drawn the same way every other theme draws
them, through the shared road-layer code, so there is nothing to supply for them.
