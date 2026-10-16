/**
 * What the command palette lists in the app, assembled from what is loaded (ah-1xl5).
 *
 * Moved out of `AppShell`'s memo so that a new kind of row is written and tested here: AppShell
 * hands over the world as it stands and the doors each row opens, and owns no row of its own.
 * Pure - no React, no store - so its tests are plain calls (`.cerebro/traps.md`, the effect-test
 * trap). The rows' look and order are `buildPaletteEntries`'; this decides which rows exist.
 */

import type {
  ArmyRecord,
  HexNoteRecord,
  MergedReportRecord,
  ParsedReport,
  ReportUnit,
  StudyPlanRecord
} from "@atlantis/core-client";
import {
  buildPaletteEntries,
  hexNotePaletteRows,
  mageNotePaletteRows,
  mageSheetPaletteAction,
  settlementPaletteRows,
  type PaletteAction,
  type PaletteEntry,
  type PaletteInput
} from "../commandPalette";
import type { GameDataEntry } from "../gameData";
import type { HexNode } from "../hexMapModel";
import { paletteFactions } from "../paletteFactions";
import type { ThemeName } from "../settingsStore";
import { SHORTCUTS, type ShortcutId } from "../shortcuts";
import { structurePaletteLabel } from "../structureLabel";
import { shownMemberCount } from "./armyRows";
import { foreignSightingsIn, pinForRow, pinLabel } from "./foreignUnits";

/** Everything the palette's rows are read from, as AppShell holds it at the moment. */
export type PaletteWorld = {
  /** A game is open - not merely a report on screen. */
  gameOpen: boolean;
  parsed: ParsedReport | null;
  merged: readonly MergedReportRecord[];
  /** The map's hexes, as the map model built them, and the turn it was built at. */
  hexes: readonly HexNode[];
  currentTurn: number | null;
  armies: readonly ArmyRecord[];
  /** This turn's units by id, for an Army's count. */
  unitsById: ReadonlyMap<string, ReportUnit>;
  /** The player's own units, in the order the units pane lists them. */
  orderedOwnUnitIds: readonly string[];
  /** How a hex reads by its id, for a hex the map does not hold. */
  hexLabel: (regionId: string) => string;
  orderCommands: readonly string[];
  /** The game data dictionary's entries, or null while the ruleset has not loaded. */
  gameDataEntries: readonly GameDataEntry[] | null;
  /** The magic tree is built, which is what the tree and the study planner open onto. */
  magicTreeReady: boolean;
  /** The report prints a region limit, so Production can be offered. */
  offersProduction: boolean;
  /** The player's own mages, for the mage sheet's "no mages". */
  mageCount: number;
  selectedRegionId: string | null;
  theme: ThemeName;
  /** Bindings are shown in macOS's spelling. */
  mac: boolean;
  hexNotes: readonly HexNoteRecord[];
  studyPlans: readonly StudyPlanRecord[];
  /** The study planner's groups, for which mages a note may be found on. */
  plannerGroups: Parameters<typeof mageNotePaletteRows>[1];
};

/** A key dialog the palette opens, as AppShell's `showOnlyKeyDialog` takes it. */
export type PaletteDialog =
  | { id: "help" | "studyPlanner" }
  | { id: "gameData"; entryId: string | null }
  | { id: "magicTree"; tag: string | null };

/** Where choosing a row goes. Each is AppShell's own, so a row does exactly what its twin elsewhere does. */
export type PaletteDoors = {
  /** Make an Army the units pane's source, unfolding the pane first (ah-mlls.4). */
  showArmy: (armyId: string) => void;
  /** Go to a unit: its hex, its level, the unit selected. `inRegion` for a unit the report places. */
  goToUnit: (unitId: string, inRegion?: string) => void;
  selectHex: (regionId: string) => void;
  /** Open a faction's details in the faction popover; null for the player's own (ah-mlls.3). */
  openFaction: (factionId: string | null) => void;
  openSettings: () => void;
  switchGame: () => void;
  setTheme: (theme: ThemeName) => void;
  openDialog: (dialog: PaletteDialog) => void;
  openExport: () => void;
  exportMageSheet: () => void;
  openBattles: () => void;
  openProduction: () => void;
  addHexNote: (regionId: string) => void;
  /** After going to the note's hex: bring the note into view in the Notes section. */
  revealHexNote: (regionId: string, noteId: string) => void;
  /** Open the study planner on the mage the note is on. */
  revealMageNote: (mageKey: string) => void;
};

/**
 * Everything the palette lists but the header's Import, Fetch and Send, which AppShell adds with
 * `paletteEntriesFor` where the send and fetch state they mirror is declared (ah-mlls.7).
 */
export function assemblePaletteInput(world: PaletteWorld, doors: PaletteDoors): PaletteInput {
  const { parsed, hexes, gameOpen } = world;
  const binding = (id: ShortcutId) => {
    const spec = SHORTCUTS.find((entry) => entry.id === id);
    return spec ? (world.mac ? spec.mac : spec.other) : undefined;
  };
  return {
    // Only with a game open, as the rail lists them (ah-mlls.4). Choosing one does what a click
    // on its rail entry does.
    armies: (gameOpen ? world.armies : []).map((army) => ({
      armyId: army.id,
      name: army.name,
      shownCount: shownMemberCount(army, world.unitsById),
      run: () => doors.showArmy(army.id)
    })),
    ownUnits: world.orderedOwnUnitIds.map((unitId) => {
      const owner = parsed?.regions
        .flatMap((region) => region.units)
        .find((candidate) => candidate.unitId === unitId);
      return { unitId, name: owner?.name ?? unitId, run: () => doors.goToUnit(unitId) };
    }),
    // Every other faction's unit standing in a hex seen this turn, in report order (ah-mlls.1).
    // The owner reads exactly as the Other factions list writes it, and choosing one goes the
    // same way as choosing an own unit - its hex, its level, and the unit selected there.
    foreignUnits: (parsed ? foreignSightingsIn(parsed) : []).map(({ regionId, unit: candidate }) => {
      // Null only for an own unit, which `foreignSightingsIn` never returns.
      const pin = pinForRow(candidate) ?? ({ kind: "hidden" } as const);
      return {
        regionId,
        unitId: candidate.unitId,
        name: candidate.name,
        faction: { label: pinLabel(pin), concealed: pin.kind === "hidden" },
        run: () => doors.goToUnit(candidate.unitId, regionId)
      };
    }),
    staleUnits: hexes.flatMap((hex) =>
      hex.knowledge !== "stale"
        ? []
        : hex.rememberedUnits.map((sighting) => ({
            regionId: hex.regionId,
            unitId: sighting.unit.unitId,
            name: sighting.unit.name,
            lastSeenTurn: sighting.lastSeenTurn,
            run: () => doors.selectHex(hex.regionId)
          }))
    ),
    // A settlement goes to its hex exactly as the hex's own row does (ah-mlls.2).
    settlements: settlementPaletteRows(hexes, world.currentTurn).map((row) => ({
      ...row,
      run: () => doors.selectHex(row.regionId)
    })),
    // Every faction the loaded reports know, opened where the attitudes list opens one: in the
    // faction popover under the header chip, with ‹ back to the player's own (ah-mlls.3).
    factions: paletteFactions({ parsed, merged: world.merged, hexes }).map((faction) => ({
      ...faction,
      run: () => doors.openFaction(faction.own ? null : faction.factionId)
    })),
    regions: hexes.map((candidate) => ({
      regionId: candidate.regionId,
      label: candidate.label,
      run: () => doors.selectHex(candidate.regionId)
    })),
    // Every structure standing in this turn's report, with the places rather than with the
    // dictionary's building pages: a structure is somewhere you go, and choosing one goes to
    // its hex exactly as choosing the hex itself does.
    structures:
      hexes.length > 0
        ? hexes.flatMap((hex) =>
            (hex.region?.structures ?? []).map((structure) => ({
              structureId: `${hex.regionId}-${structure.structureId}`,
              label: structurePaletteLabel(structure, world.hexLabel(hex.regionId)),
              lastSeenTurn: hex.knowledge === "stale" ? (hex.lastSeenTurn ?? undefined) : undefined,
              run: () => doors.selectHex(hex.regionId)
            }))
          )
        : (parsed?.regions ?? []).flatMap((region) =>
            region.structures.map((structure) => ({
              structureId: `${region.regionId}-${structure.structureId}`,
              label: structurePaletteLabel(structure, world.hexLabel(region.regionId)),
              run: () => doors.selectHex(region.regionId)
            }))
          ),
    actions: paletteActions(world, doors, binding),
    orderCommands: world.orderCommands,
    gameData: world.gameDataEntries ?? [],
    openGameData: (entryId) => doors.openDialog({ id: "gameData", entryId }),
    // The notes the player wrote (ah-mlls.5), only with a game open and a report loaded: no
    // report, no map to go to. A hex note's place reads as the hex's own palette row; choosing
    // one goes there as that row does, then asks the Notes section to bring the note into view.
    hexNotes:
      gameOpen && parsed
        ? hexNotePaletteRows(
            world.hexNotes,
            (regionId) =>
              hexes.find((candidate) => candidate.regionId === regionId)?.label ?? world.hexLabel(regionId)
          ).map((row) => ({
            ...row,
            run: () => {
              doors.selectHex(row.regionId);
              doors.revealHexNote(row.regionId, row.noteId);
            }
          }))
        : [],
    // A mage note only while the planner can open and the mage is in this turn's report.
    mageNotes:
      gameOpen && world.magicTreeReady
        ? mageNotePaletteRows(
            world.studyPlans,
            world.plannerGroups,
            new Set((parsed?.regions ?? []).flatMap((region) => region.units.map((unit) => unit.unitId)))
          ).map((row) => ({ ...row, run: () => doors.revealMageNote(row.key) }))
        : []
  };
}

/** The app's own commands, each offered only where it can do something. */
function paletteActions(
  world: PaletteWorld,
  doors: PaletteDoors,
  binding: (id: ShortcutId) => string | undefined
): PaletteAction[] {
  const { parsed, gameOpen, selectedRegionId } = world;
  return [
    { id: "settings", label: "Open settings", run: doors.openSettings },
    // Only where the picker can actually open: on the gate screen it renders nowhere, and
    // an openPopover left set would pop the picker uninvited into the next game.
    ...(gameOpen ? [{ id: "switch-game", label: "Switch game", run: doors.switchGame }] : []),
    {
      id: "toggle-theme",
      label: "Toggle theme",
      run: () => doors.setTheme(world.theme === "dark" ? "light" : "dark")
    },
    {
      id: "shortcuts",
      // Named for what it shows and for what a player would type looking for it: somebody
      // hunting "shortcuts" finds the same entry as somebody hunting "getting around".
      label: "Getting around (shortcuts and mouse)",
      binding: binding("help"),
      run: () => doors.openDialog({ id: "help" })
    },
    // Only once the ruleset has loaded: the palette already offers no game data at all in
    // that state, and a door onto seven empty tabs is worse than no door.
    ...(world.gameDataEntries !== null
      ? [
          {
            id: "browse-game-data",
            // "Browse" says it opens something to look around in, rather than reading as one
            // of the ~270 dictionary entries it sits among.
            label: "Browse game data",
            binding: binding("gameData"),
            run: () => doors.openDialog({ id: "gameData", entryId: null })
          }
        ]
      : []),
    // Gated on the ruleset exactly as the dictionary is: the tree is nothing but the ruleset
    // read a second way, so with no ruleset there is no door and F3 does nothing.
    ...(world.magicTreeReady
      ? [
          {
            id: "magic-study-tree",
            label: "Magic study tree",
            binding: binding("magicTree"),
            run: () => doors.openDialog({ id: "magicTree", tag: null })
          },
          // The same gate again: the planner draws standings, which are the ruleset read a third way.
          {
            id: "study-planner",
            label: "Study planner",
            binding: binding("studyPlanner"),
            run: () => doors.openDialog({ id: "studyPlanner" })
          }
        ]
      : []),
    // Only with a report on screen: an export needs a turn to name itself after and a map to
    // describe, and neither exists before one is imported.
    ...(parsed ? [{ id: "export-map", label: "Export map", run: doors.openExport }] : []),
    // Never hidden, unlike Export map (ah-mlls.8): greyed, it says what is missing. Gated
    // exactly as the Export menu's item is, and runs the same export.
    mageSheetPaletteAction({
      hasReport: parsed !== null,
      hasGameData: world.gameDataEntries !== null,
      mageCount: world.mageCount,
      run: doors.exportMageSheet
    }),
    // Only when the turn actually had a battle - as with the chip, a command that opens onto
    // nothing is worse than no command at all.
    ...(parsed && parsed.battles.length > 0
      ? [{ id: "open-battles", label: "Open battles", run: doors.openBattles }]
      : []),
    ...(parsed && world.offersProduction
      ? [{ id: "open-production", label: "Production", run: doors.openProduction }]
      : []),
    // Only with a game open and a hex selected: a note needs both to be saved anywhere - ah-o1t.
    ...(gameOpen && selectedRegionId
      ? [
          {
            id: "add-hex-note",
            label: "Add note to this hex",
            run: () => doors.addHexNote(selectedRegionId)
          }
        ]
      : [])
  ];
}

/**
 * The palette's rows: `leading` - the header's Import, Fetch and Send, in the header's order -
 * ahead of the app's other commands, then everything else as `buildPaletteEntries` orders it.
 */
export function paletteEntriesFor(
  input: PaletteInput,
  leading: readonly PaletteAction[]
): PaletteEntry[] {
  return buildPaletteEntries({ ...input, actions: [...leading, ...(input.actions ?? [])] });
}
