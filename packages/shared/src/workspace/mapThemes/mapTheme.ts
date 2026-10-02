/**
 * What a map theme is.
 *
 * A theme decides *how* a hex is drawn; `hexView.ts` decides *what* there is to draw. The split is
 * the whole point: the map's interaction, viewport, route overlay, selection and accessibility
 * layers are written once and shared, and a theme is only the paint.
 *
 * A theme is one directory and one registry entry. It may not import another theme, and adding or
 * removing one may not touch `MapCanvas.tsx` - see `docs/ui/map-themes.md`.
 *
 * A theme must also not import the settings store. Everything a theme is allowed to know arrives in
 * its `HexView`s, and the store imports the registry to validate the persisted theme id - so a
 * theme reaching back for a setting would close that loop into an import cycle.
 */

import type { ComponentType } from "react";
import type { MarkSpot } from "./biomeSymbols";
import type { HexView } from "./hexView";

/** What every theme layer receives: the prepared hexes of one knowledge bucket, and nothing else. */
export type LayerProps = { views: HexView[] };

export type MapTheme = {
  /** Stable, and persisted in the settings store: renaming one resets everybody's choice. */
  id: string;
  /** What the settings picker shows. */
  label: string;
  /**
   * How much of the shared fade this theme lets through, 0 < n <= 1. `buildHexViews` scales
   * `fogOpacity` by it for every faded state alike - a hex known only by name and a stale sighting
   * both - so a theme paints `view.fogOpacity` as it arrives and never damps it itself. Declared
   * here, applied there: the theme owns the number, the shared code owns the rule that both states
   * get the same one (ah-rgp's review found every theme damping one and not the other).
   */
  fogDamping: number;
  /**
   * Gradients, hatches and filters this theme needs, rendered inside the map's own `<defs>`. The
   * twelve biome patterns are shared and always present, so a theme never declares those.
   */
  Defs?: ComponentType;
  /** Terrain fill, the theme's texture treatment, and the knowledge and staleness overlays. */
  TerrainLayer: ComponentType<LayerProps>;
  /** Road spokes. Drawn in a layer of its own, beneath the route overlay. */
  RoadLayer: ComponentType<LayerProps>;
  /** Settlements, units, structures and labels. */
  MarkLayer: ComponentType<LayerProps>;
  /**
   * Where this theme draws its marks in a hex - every mark and label its layers put inside the
   * hex for this view - as circles in fractions of `HEX_RADIUS`, so the biome symbols can keep
   * clear of them (ah-d9jb.4). Worked out from the same anchors the layers draw with, so the two
   * cannot drift. Roads are not declared here: they are the same geometry under every theme, and
   * `roadSpots` covers them. A ring round the rim claims nothing; no symbol reaches it.
   */
  markFootprint: (view: HexView) => MarkSpot[];
  /**
   * What marks the selected hex, drawn about the hex's centre in world units, in place of the map's
   * own selection ring. Optional: without one the map draws its white ring. A theme that supplies
   * one owns making the selection unmistakable on every terrain it paints, at every zoom.
   */
  SelectionMark?: ComponentType;
  /**
   * One effect over the whole visible map - a scan line, a glint - drawn in screen space above the
   * world and never taking a pointer. Optional, and only drawn while the map may animate.
   */
  Overlay?: ComponentType;
};
