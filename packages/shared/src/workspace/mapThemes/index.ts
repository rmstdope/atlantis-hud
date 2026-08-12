/**
 * The map theme registry.
 *
 * Adding a theme is one entry in the list below plus one directory beside this file; removing one
 * is deleting both. Nothing else in the app knows a theme by name - the settings picker reads its
 * options from here, and `MapCanvas` renders whichever theme it is handed. See
 * `docs/ui/map-themes.md`.
 */

import type { MapTheme } from "./mapTheme";
import { cartographersTable } from "./cartographersTable/index";
import { classic } from "./classic/index";
import { tacticalHud } from "./tacticalHud/index";

/** In the order the settings picker offers them: the map as it was, then the five designs. */
export const MAP_THEMES: readonly MapTheme[] = [classic, cartographersTable, tacticalHud];

/** The map as it has always looked, and what an unrecognised choice falls back to. */
export const DEFAULT_MAP_THEME_ID = "classic";

export function isMapThemeId(id: string, themes: readonly MapTheme[] = MAP_THEMES): boolean {
  return themes.some((theme) => theme.id === id);
}

/**
 * The theme to draw with.
 *
 * Falls back rather than failing: storage is hand-editable, and a build can be downgraded past a
 * theme it once shipped. A map that renders in the wrong style is a nuisance; one that renders
 * nothing is a broken app.
 *
 * The last resort is Classic itself rather than the registry's first entry, so the signature holds
 * even for a registry that is empty - which the shipped one never is, but a caller passing its own
 * list can be.
 */
export function getMapTheme(id: string, themes: readonly MapTheme[] = MAP_THEMES): MapTheme {
  return (
    themes.find((theme) => theme.id === id) ??
    themes.find((theme) => theme.id === DEFAULT_MAP_THEME_ID) ??
    classic
  );
}

export type MapThemeOption = { id: string; label: string };

/** What the settings picker offers, derived from the registry so a new theme needs no UI work. */
export function mapThemeOptions(themes: readonly MapTheme[] = MAP_THEMES): MapThemeOption[] {
  return themes.map(({ id, label }) => ({ id, label }));
}

export type { MapTheme, LayerProps } from "./mapTheme";
export type { HexView, HexViewOptions } from "./hexView";
export { buildHexView, buildHexViews } from "./hexView";
