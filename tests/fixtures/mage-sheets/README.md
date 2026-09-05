# Mage sheet fixtures

Mage sheets, the report fragment Atlantis HUD writes when you export your mages for an ally to
import — the file `export_mage_sheet` (`crates/core/src/report/export.rs`) produces and
`mageSheetImport.ts` (`packages/shared/src/`) reads back.

**These are generated, not captured.** Each is a fresh export of one committed report in
`tests/fixtures/reports/` over a fixed set of unit ids. That is what makes them safe to commit: a
Rust test regenerates all of them and compares byte for byte, so a change to the exporter's output
turns them red rather than leaving them quietly describing a format the code no longer writes.

They live here rather than in `tests/fixtures/reports/` because a mage sheet is not a turn report,
and every guard over that directory lists `.rep` files only — a `.txt` dropped there would be
governed by nothing at all (ah-fu0j).

## The fixtures

| file | source report | mages exported | good for |
|---|---|---|---|
| `mages-neworigins-3.0.0-g7-f39-t17.txt` | `neworigins-3.0.0-g7-f39-t17.rep` | `1447 1448 7310 7311` | the earlier sheet of a pair; 4 mages, three of them inside structures |
| `mages-neworigins-3.0.0-g7-f39-t18.txt` | `neworigins-3.0.0-g7-f39-t18.rep` | `1447 1448 7310 7311 7722` | the ordinary replacement: same faction one turn later, one mage gained and none lost |
| `mages-neworigins-3.0.0-g7-f39-t18-trimmed.txt` | `neworigins-3.0.0-g7-f39-t18.rep` | `7310 7722` | the only committed way to reach the missing-mages question: against the t17 sheet, three mages have gone |
| `mages-neworigins-3.0.0-g7-f62-t18.txt` | `neworigins-3.0.0-g7-f62-t18.rep` | `916 1656 1657 1658 1659` | faction 62's own sheet, for the "that is your own faction's mage sheet" refusal in a faction-62 workspace |

The `-trimmed` file is not hand-edited: it is the same turn-18 report exported with a smaller id set.
`write_mage_region` (`crates/core/src/report/write.rs`) writes only named units and skips a structure
with none, so the three building blocks simply do not appear.

As with the report fixtures, a fifth sheet is added only for a shape none of these four has.

## Naming

```
mages-<ruleset>-<version>-g<game>-f<faction>-t<turn>[-<variant>].txt
```

The reports' pattern with a `mages-` prefix and an optional variant. The game matters for the same
reason it does there: a faction id is only unique within one game.

## Regenerating

```bash
UPDATE_MAGE_SHEET_FIXTURES=1 cargo test -p atlantis-hud-core --test mage_sheet_fixtures
```

Then run it again without the variable and see it pass. A failure of that test with the variable
unset means one of two things: a regression in `export_mage_sheet`, or a deliberate change to what it
writes — in which case regenerate, and read the diff before committing it.

That path refreshes the *content* of sheets that already exist. It cannot bootstrap a new or deleted
one: `crates/fixtures/src/lib.rs` reaches each file with `include_str!`, so a file named there and
missing from disk is a compile error in a crate `crates/core` depends on, before any test runs. To
add a sheet, or to restore a deleted one, write the file first — a `touch` is enough, the
regeneration then fills it.

## The lockstep rule

Every file here is named once per language: `crates/fixtures/src/lib.rs` (`ALL_MAGE_SHEETS`) for
Rust, `packages/fixtures/src/index.ts` (`MAGE_SHEETS`) for TypeScript. Both carry a test that fails
when this directory and the names in that module disagree, and `scripts/mageSheetFixtures.test.ts`
checks the naming rule, the marker line, the absence of a password, and that every file is listed in
this README. So adding a fixture is: `touch` the file here, add its const to `ALL_MAGE_SHEETS` with
its source report and unit ids, regenerate, name it in `packages/fixtures/src/index.ts` too, add a
row to the table above, and run the tests.
