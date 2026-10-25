# Requirements

Agreed with the navigator 2026-10-25. Each requirement keeps its number for ever;
a dropped one is struck, never renumbered.

A `Proven by:` line names the spec file and the test's title.

## Games

R1  The player creates a game, naming it and choosing the ruleset it is played under (New Origins or a New Age world).
    Proven by: tests/smoke/games.spec.ts "creating a game asks which ruleset it is played under"
R2  The player switches between games, and renames, resets or deletes one; each game keeps its own turns and orders.
    Proven by: tests/smoke/games.spec.ts "the header names the open game, and the picker switches between them"
R3  The game the player was last in reopens on the next launch, on the turn and map view they left it at.
    Proven by: tests/smoke/games.spec.ts "the game a player was last in reopens on the next launch"
R4  Orders are saved as they are typed and are still there after a reload.
    Proven by: tests/smoke/persistence.spec.ts "orders typed into a game are still there after a reload"

## Keeping games safe

R5  The player exports a whole game to one backup file and imports it again, on the same platform or the other, keeping both or replacing the existing one.
    Proven by: tests/smoke/backup.spec.ts "a game backup restores turns, orders and remembered map after storage is cleared"
R6  A game or backup written by a newer version is refused with an explanation and left as it was.
    Proven by: tests/smoke/engine-turns.spec.ts "a game stored by a newer build is refused, and left as it was"
R7  A game open in another browser tab is not opened twice; the player is told, and can take it over once that tab lets go.
    Proven by: tests/smoke/tabs.spec.ts "a game another tab holds says so, and Try again opens it once the tab lets go"
R8  On the desktop app, an imported turn and typed orders are kept in a file on disk.
    Proven by: tests/native/workspace.spec.ts "imports the turn 72 report and persists it to the sidecar database"

## Loading reports

R9  The player loads a turn report and sees the turn it describes: map, regions and units.
    Proven by: tests/smoke/workspace.spec.ts "loads a report and shows the turn it describes"
R10 The player imports a run of turns in one batch; older turns are kept for history rather than shown.
    Proven by: tests/smoke/workspace.spec.ts "imports a run of turns and an ally"
R11 Loading another faction's report asks whether to merge it into the map or switch to that faction.
    Proven by: tests/smoke/workspace.spec.ts "a report from another faction can take over the workspace"
R12 The player can see which lines of a report could not be read.
    Proven by: tests/smoke/workspace.spec.ts "the header chip opens the lines that could not be read"

## Fetching and sending

R13 On a New Age game the player fetches this turn's report, and every missing earlier turn, from the world.
    Proven by: tests/smoke/newage-fetch.spec.ts "fetches every missing turn in one press and says what happened"
R14 On a New Age game the player sends orders to the world and sees what it answered.
    Proven by: tests/smoke/newage-send.spec.ts "sends orders and reports that the world saved them with errors"
R15 Fetch and Send also work in the web app for a New Age game.
    Proven by: tests/smoke/newage-web.spec.ts "a New Age game on the web fetches this turn"
R16 On the desktop, a New Origins game fetches the latest report from the site.
    Proven by: tests/smoke/neworigins-fetch.spec.ts "fetches this turn"

## Rulesets and game data

R17 The player changes a game's ruleset, and is warned first when the change would leave names in its reports undefined.
    Proven by: tests/smoke/settings.spec.ts "a change that leaves names undefined warns first, and Cancel or Escape keeps the ruleset"
R18 A report naming things its ruleset does not define is flagged once, with a prefilled issue the player can send.
    Proven by: tests/smoke/ruleset-check.spec.ts "the reporting step copies the list, opens a prefilled issue and the world"
R19 The player looks up any skill, item, terrain or structure in the game data dictionary (F2).
    Proven by: tests/smoke/shortcuts.spec.ts "F2 opens the game data cold, on All with its first entry showing"

## Map

R20 The player pans, zooms and fits the hex map by mouse and keyboard, and the map wraps east to west.
    Proven by: tests/smoke/workspace.spec.ts "panning east forever stays on the map"
R21 The player selects a hex by click or keyboard, unexplored ones included, and sees its region details and units.
    Proven by: tests/smoke/workspace.spec.ts "selecting a hex fills the region panel and the unit table together"
R22 The player switches between the map's levels.
    Proven by: tests/smoke/workspace.spec.ts "the level selector in the header changes level"
R23 The player chooses which badges and decorations the map draws, and its theme; the choice survives a reload.
    Proven by: tests/smoke/workspace.spec.ts "each badge can be turned off on its own, and the set survives a reload"

## Units

R24 The player sees the units of a hex, or all their own units, in a table they can sort, filter and arrange.
    Proven by: tests/smoke/workspace.spec.ts "sorting by a column reorders the table, own units still first"
R25 The table and unit panel show what the orders will make of each unit next month: silver, items, men and movement.
    Proven by: tests/smoke/workspace.spec.ts "orders change the units table to show the coming month"
R26 The player lists other factions' units and opens a faction's dossier.
    Proven by: tests/smoke/foreignUnits.spec.ts "choosing Other factions lists units of other factions"
R27 The player groups units into named Armies and exports an Army as a battle file.
    Proven by: tests/smoke/armies.spec.ts "a new Army is named in the rail and appears among the others"

## Writing orders

R28 The player writes a unit's orders in an editor that offers completions and snippets and can undo and redo.
    Proven by: tests/smoke/orders-editor.spec.ts "a half-typed command offers its completions"
R29 With Order OCD on, keywords are uppercased and blocks indented as the player types.
    Proven by: tests/smoke/orders-editor.spec.ts "with Order OCD on, a keyword uppercases as the word ends and a quoted name is left alone"
R30 A unit formed this month gets its own row, and its orders are edited inside the FORM that creates it.
    Proven by: tests/smoke/orders-editor.spec.ts "a unit formed this month edits its own orders inside the FORM that creates it"
R31 The player exports the orders file to send in, and imports an orders file.
    Proven by: tests/smoke/workspace.spec.ts "exports the orders with the unit descriptions"

## Checking orders

R32 Orders are checked against the rules as the player types; each problem is marked in the editor and listed against the unit that owns it.
    Proven by: tests/smoke/workspace.spec.ts "a bad order names itself, and belongs to the unit that carries it"
R33 The player walks from problem to problem across every unit (F8 and the walk buttons).
    Proven by: tests/smoke/shortcuts.spec.ts "F8 walks to a problem in another unit"
R34 The player silences an advisory check everywhere at once, or hides the problem list.
    Proven by: tests/smoke/workspace.spec.ts "a silenced advisory check disappears everywhere at once"
R56 The player mends a marked problem with its quick fix from the editor, in one step that undo takes back.
    Proven by: tests/smoke/orders-editor.spec.ts "Add quotes mends a description the game would cut to its first word"

## Movement

R35 The player plans a move for their own unit, unexplored ground included, and sees its cost and what stands in the way.
    Proven by: tests/smoke/workspace.spec.ts "planning a move shows its cost and what stands in the way"
R36 A planned route is written into the unit's orders.
    Proven by: tests/smoke/workspace.spec.ts "a planned route can be written into the unit"
R37 Written moves, and the courses of fleets, are drawn on the map.
    Proven by: tests/smoke/workspace.spec.ts "a written move order is drawn solid for next turn and dotted beyond"

## Magic

R38 The player browses the magic skill tree and graph, tinted for a chosen mage to show where he stands.
    Proven by: tests/smoke/magic-standing.spec.ts "the tree opens tinted for the selected mage and says where he stands"
R39 The player plans mages' studies, teaching and casts over coming turns, and the plan survives a reload.
    Proven by: tests/smoke/study-planner.spec.ts "the Schedule plans a mage's studies, and the plan survives a reload"
R40 The planner writes next turn's study and casts into the orders, and the write can be undone.
    Proven by: tests/smoke/study-orders-write.spec.ts "the Orders tab writes the plan into the document, and the write can be undone"

## Reading the turn

R41 The player reads the turn's errors, events and battles, and jumps to a unit or hex they name.
    Proven by: tests/smoke/workspace.spec.ts "the header chip opens the turn's errors and events"
R42 The player compares the turn with another one and sees which units and hexes changed.
    Proven by: tests/smoke/workspace.spec.ts "the changes dialog reads a real pair"
R43 The player sees their faction's attitudes and production.
    Proven by: tests/smoke/workspace.spec.ts "the faction view opens Production, which says a faction with no Martial points may not tax or produce"
R44 The player sees trade routes and goes to one on the map.
    Proven by: tests/smoke/workspace.spec.ts "the trade chip lists routes and flies the map to one"

## Finding things

R45 The player finds a unit, hex, settlement, structure, gate, faction or action by name from the palette (Mod+K) and goes to it.
    Proven by: tests/smoke/shortcuts.spec.ts "the palette opens on Mod+K, finds a unit, and Enter goes to it"
R46 The player writes notes on hexes and mages, which survive a reload and are found from the palette.
    Proven by: tests/smoke/workspace.spec.ts "a note written on a hex is still there after a reload"
R47 A first-time player is greeted with how to get around, and can turn the greeting off.
    Proven by: tests/smoke/startup-help.spec.ts "greets a first-time player with the shortcuts overlay"

## Sharing with allies

R48 The player exports the known map, or a selected area, and imports a map export, including one written by AtlaClient.
    Proven by: tests/smoke/map-export.spec.ts "exports the whole known map when nothing was selected"
R49 The player writes their mages out as a sheet for an ally, and takes an ally's sheet in.
    Proven by: tests/smoke/mage-sheet.spec.ts "takes an ally's mage sheet back in"

## Layout and settings

R50 The player sets the theme, the interface size and pane transparency, and the choices survive a reload.
    Proven by: tests/smoke/settings.spec.ts "the theme choice restyles the app and survives a reload"
R51 The player folds and resizes the panes, and the layout survives a reload.
    Proven by: tests/smoke/workspace.spec.ts "panels fold away and come back"
R52 The player drags a dialog by its top bar, and it stays inside the window.
    Proven by: tests/smoke/dialog-drag.spec.ts "dragging the Settings top bar moves it and lifts the veil, which stays lifted"

## Installing

R53 The web app installs as an app and opens its workspace with the network cut.
    Proven by: tests/pwa/install.spec.ts "the workspace still opens with the network cut"
R54 On the desktop, exports go through the system save dialog rather than a browser download.
    Proven by: tests/smoke/desktop-shell.spec.ts "an orders export goes through the save dialog, with no browser download"
R55 Each release has a desktop app that installs and runs on macOS, Windows and Linux.
    Proven by: .github/workflows/release.yml "Launch the built bundle and check its window opens (R55)", in the macos, linux and windows jobs (scripts/desktopLaunchCheck.ts)
