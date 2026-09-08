# AtlaClient map fixtures

A map exported by **AtlaClient**, another Atlantis client, from its *Save map* dialog. It is written
in the game's own region syntax with no report header of any kind, and each region's underline
carries a turn stamp — `;16` for a hex as new as the file, `;16-11` for one last seen on turn 11,
and `;16-0` for one AtlaClient cannot date. `ARegion::WriteReport` (`source/region.cpp` in
`Atlantis-PBEM/Atlaclient`) is what writes them.

They live here rather than in `tests/fixtures/reports/` because an AtlaClient map is not a turn
report and names no faction, and every guard over that directory lists `.rep` files matching
`neworigins-<v>-g<G>-f<F>-t<T>.rep` — a file dropped there would be governed by nothing (ah-fu0j).

## The fixtures

| file | hexes | stamps | good for |
|---|---|---|---|
| `atlaclient-map-t16.txt` | 83 | 49 at turn 16, 29 between turns 5 and 15, 5 undated (`;16-0`) | every case the import path has: current, older and undated hexes in one file |

## Where it came from, and what was done to it

**Captured, not generated** — this is a real export the navigator made from their own AtlaClient
save, and nothing in this repository can regenerate it. It was anonymised before committing, at the
navigator's request, by `.cerebro/scratch/ah-t1oi-anonymise.py` (ah-t1oi):

- every hex coordinate shifted by `(+12, +8)` — both even, because an Atlantis region's `x` and `y`
  always share a parity and an odd shift would produce coordinates the game can never print;
- every unit number shifted by `+5000`;
- every faction renamed and renumbered, except `The Guardsmen (1)`, which is the engine's own guard
  faction, identical in every Atlantis game and carrying nothing personal — renaming it would make
  the fixture stop looking like a real report.

**Unit names are left alone** (`Gandalf`, and the rest), for the reason
`tests/fixtures/reports/README.md` already gives: unit and faction names are public to everyone who
played that game.

Because it is captured, it must never be rewritten to make a test pass. A test that disagrees with
this file is a test that disagrees with what AtlaClient actually writes.

## The lockstep rule

The file is named once per language: `crates/fixtures/src/lib.rs` (`ALL_ATLACLIENT_MAPS`) for Rust,
`packages/fixtures/src/index.ts` (`ATLACLIENT_MAPS`) for TypeScript. Both carry a test that fails
when this directory and the names in that module disagree. Adding a fixture is: put the file here,
name it in both modules, add a row to the table above, and run the tests.
