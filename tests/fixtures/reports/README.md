# Report fixtures

Real NewOrigins 3.0.0 turn reports, used by `crates/core/tests/*.rs`,
`packages/browser-core/src/parseReportFull.test.ts`, `packages/ruleset/src/capacity.test.ts` and the
Playwright suites under `tests/smoke/` and `tests/native/`.

## Where they came from

A personal archive of 209 reports across eight game/faction runs of the author's own Borg faction,
played between 2021 and 2024 (surveyed at `~/Documents/Atlantis`, off this repository). Every one of
them is `NewOrigins, Version: 3.0.0 (beta)` - what varies between them is the *engine* version
(5.2.4 or 5.2.5) and the game, never the ruleset.

25 of the 209 are committed here: four from the original set this parser was first written against,
and 21 added by ah-dyi so the parser is exercised against shapes none of those four could reach - a
fresh faction, a report with no orders template, two factions of one game merging in the same turn,
and a late-game report far larger than anything committed before. The other ~184 stay in the
archive; the selection rule below says what would earn one a place here later.

`neworigins-3.0.0-g8-f73-t71.rep` is the one exception: hand-written for issue #53 rather than
captured, because no second real report of faction 95's turn 71 exists in the archive. It stands in
for an ally's report of a turn faction 95 also has.

## Naming

`neworigins-<ruleset version>-g<game>-f<faction>-t<turn>.rep`

The game is part of the name because a faction id is only unique within one game - faction 42 exists
in both game 2 and game 3 here, so `f42-t0` alone would be ambiguous between two entirely different
turns. `scripts/reportFixtures.test.ts` enforces the pattern on every fixture in this directory.

## Redaction

Every `#atlantis <id> "..."` line has its quoted value replaced with `<password>`, and nothing else
is touched - faction names, allies and unit names are already public to everyone who played in that
game, and scrubbing them would destroy what these fixtures are for.
`scripts/reportFixtures.test.ts` checks this on every fixture, every run, and its failure message
never prints the offending line.

## Selection rule

A fixture is added only for a shape no committed fixture already has. The "good for" column below is
the point of this table: it is what stops the next import adding a twelfth near-duplicate of a turn
already well covered.

## The fixtures

| file | game | faction | turn | engine | good for |
|---|---|---|---|---|---|
| `neworigins-3.0.0-g2-f42-t0.rep` | 2 | 42 | 0 | 5.2.4 | a fresh faction's first turn - no history, nothing to a merge |
| `neworigins-3.0.0-g3-f42-t1.rep` | 3 | 42 | 1 | 5.2.4 | a fresh faction's first turn, smallest committed report |
| `neworigins-3.0.0-g3-f42-t40.rep` | 3 | 42 | 40 | 5.2.4 | turn-over-turn comparison, 1 of 3 consecutive |
| `neworigins-3.0.0-g3-f42-t41.rep` | 3 | 42 | 41 | 5.2.4 | turn-over-turn comparison, 2 of 3 consecutive |
| `neworigins-3.0.0-g3-f42-t42.rep` | 3 | 42 | 42 | 5.2.4 | turn-over-turn comparison, 3 of 3 consecutive |
| `neworigins-3.0.0-g3-f42-t82.rep` | 3 | 42 | 82 | 5.2.4 | a late, large turn - the stress case, most likely to expose a quadratic |
| `neworigins-3.0.0-g4-f17-t0.rep` | 4 | 17 | 0 | 5.2.4 | a fresh faction's first turn |
| `neworigins-3.0.0-g5-f21-t0.rep` | 5 | 21 | 0 | 5.2.5 | a fresh faction's first turn |
| `neworigins-3.0.0-g5-f21-t23.rep` | 5 | 21 | 23 | 5.2.5 | turn-over-turn comparison, 1 of 3 consecutive (turn 22 is missing from the archive) |
| `neworigins-3.0.0-g5-f21-t24.rep` | 5 | 21 | 24 | 5.2.5 | turn-over-turn comparison, 2 of 3 consecutive |
| `neworigins-3.0.0-g5-f21-t25.rep` | 5 | 21 | 25 | 5.2.5 | turn-over-turn comparison, 3 of 3 consecutive |
| `neworigins-3.0.0-g5-f21-t39.rep` | 5 | 21 | 39 | 5.2.5 | a late, large turn |
| `neworigins-3.0.0-g7-f39-t17.rep` | 7 | 39 | 17 | 5.2.5 | merging two factions of the same game, same turn - pairs with f62 t17 |
| `neworigins-3.0.0-g7-f39-t18.rep` | 7 | 39 | 18 | 5.2.5 | merging two factions of the same game, same turn - pairs with f62 t18 |
| `neworigins-3.0.0-g7-f62-t0.rep` | 7 | 62 | 0 | 5.2.5 | a fresh faction's first turn |
| `neworigins-3.0.0-g7-f62-t17.rep` | 7 | 62 | 17 | 5.2.5 | merging two factions of the same game, same turn - pairs with f39 t17 |
| `neworigins-3.0.0-g7-f62-t18.rep` | 7 | 62 | 18 | 5.2.5 | merging two factions of the same game, same turn - pairs with f39 t18 |
| `neworigins-3.0.0-g7-f62-t20.rep` | 7 | 62 | 20 | 5.2.5 | a report with no orders template at all |
| `neworigins-3.0.0-g7-f95-t70.rep` | 7 | 95 | 70 | 5.2.5 | the player's own faction, one turn before the next fixture |
| `neworigins-3.0.0-g7-f95-t71.rep` | 7 | 95 | 71 | 5.2.5 | the main acceptance fixture: a full city, structures, battles, an orders template |
| `neworigins-3.0.0-g7-f95-t72.rep` | 7 | 95 | 72 | 5.2.5 | turn-over-turn comparison, completes the 70-71-72 run; also the largest committed report |
| `neworigins-3.0.0-g7-f95-t74.rep` | 7 | 95 | 74 | 5.2.5 | a later, larger turn in the same game as t70-72 |
| `neworigins-3.0.0-g8-f73-t1.rep` | 8 | 73 | 1 | 5.2.5 | a fresh faction's first turn |
| `neworigins-3.0.0-g8-f73-t2.rep` | 8 | 73 | 2 | 5.2.5 | a small early report, faction and per-unit error parsing |
| `neworigins-3.0.0-g8-f73-t71.rep` | 8 | 73 | 71 | 5.2.5 | hand-written; an ally's report of the same turn f95 t71 describes, for merge testing |
