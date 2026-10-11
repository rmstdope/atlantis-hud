# ah-09bu — retrospective

## A silver fix was proven on a surface that never shows silver

**What happened.** ah-ixq7 fixed claimed silver given to a dissolving formed unit, and its test
(`effects.rs` `claimed_silver_given_to_a_dissolving_unit_reverts`) asserted a `GiftReverted` on the
ITEMS preview. The ITEMS preview was right. But the ITEMS popup filters silver out
(`packages/shared/src/silverTag.ts`, ah-6m7b.5.1), and the SILVER column, the one place silver is
drawn, had no dissolve at all. The navigator saw the 1000 vanish during verification, and the bead
came back as ah-09bu. Reproducing it here first meant probing the ITEMS preview on the real report
twice, and getting the right answer both times, before checking which surface actually draws silver.

**Why.** The two ledgers (ITEMS in `effects.rs`, SILVER in `semantics.rs`) both model silver, but
only one of them is visible for it. A test on the invisible one passes whatever the visible one does.

**Cost.** One failed verification, a new bug bead, and about 20 minutes of reproducing on the wrong
surface.

**Prevent by.** A test for a silver behaviour asserts on the SILVER column (`review_turn`'s
`UnitSilver.changes`), or on both surfaces as `crates/core/tests/gifts_across_both_surfaces.rs`
does. Never on the ITEMS preview alone. A line saying so in `crates/core/tests/gifts_across_both_surfaces.rs`'s
module doc, or in `.cerebro/traps.md`, would carry it.

**Seen before.** Not in `docs/retrospectives/`.

## Three tests relied on a formed unit with nobody keeping its silver

**What happened.** Two `formed_units` tests had the formed unit `BUY 5 PLAI`. The New Origins data
has no PLAI (`pnpm run atlantis data PLAI`), so the unit gained nobody, and it should already have
dissolved under `rules/form`. They passed only because the SILVER ledger never dissolved anyone. A
third (ah-k1ue) formed a sharer with no men and had it lend to a STUDY that runs after the dissolve.

**Why.** Fixture item tags are not checked against the ruleset.

**Cost.** One red gate and about 10 minutes.

**Prevent by.** A fixture's man tag comes from `with_men` (HUMN) or a `pnpm run atlantis data`
lookup, never typed from memory.

**Seen before.** Not in `docs/retrospectives/`.
