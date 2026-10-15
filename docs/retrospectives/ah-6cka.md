# ah-6cka — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-15
- **PR:** #1603

## A share-purse rule that changed no core test turned the smoke suite red over a passenger's study

**What happened.** The rework capped what a unit that ends the month elsewhere may claim on the
share purse of the hex it leaves. The cap applied at every moment after movement (STUDY, TRANSPORT,
month end). The whole core suite (3708 lib tests and every integration binary) and
`pnpm run check:fast` passed. CI's smoke shard 2 then failed in both shells, in two tests about
route lines ('selecting a passenger draws the fleet's voyage' and the test after it), with a
strict-mode locator violation. The cause: sharing passenger Drones (10594, g5-f21-t24) studies FISH
for $200 aboard a sailing raft. It lost its STUDY loan, grew a silver warning, and that warning's
`sr-only` "unit 10594" made `selectUnit`'s button lookup ambiguous. The follow-up review then found
that restoring the wide cap still left every core test green.

**Why.** No core test pinned a leaving unit's STUDY or TRANSPORT draw on the hex it leaves. That
draw is the pre-existing (and by `rules/share` questionable) behaviour the wider cap removed, and
nothing in the hex the unit reaches picks the claim up. The only coverage was a smoke test that
reaches the case by accident and asserts nothing about silver.

**Cost.** One red CI cycle (one of three fix attempts), a delta review, and a fixture-based core
test added afterwards (`crates/core/tests/a_sharing_passenger_keeps_its_study_loan.rs`).

**Prevent by.** When a change narrows or widens which units the share purse lends to
(`Sharing`, `Lending::settle`, `sharing_purse_over` in `crates/core/src/orders/semantics.rs`), run
`review_turn` on the real fixtures before the PR. One quick way is a throwaway integration test
over `atlantis_hud_fixtures` with `shipment_measures`-traced month ends, diffing each unit's
`borrowed_for_orders` and silver findings against `origin/main`. A real report has passengers,
sharers and studies together that the synthetic `region_at` fixtures do not.

**Seen before.** ah-wyj8 (the movement trace placed a unit wrongly and only the smoke suite showed
it); ah-gjq4 (a figure the change made wrong, caught only by the smoke suite).

## A blanket `sed -i` meant for one new test rewrote three unrelated tests

**What happened.** To fix the item tag in a newly written test, I ran
`sed -i '' 's/GIVE NEW 1 1 LEAD/GIVE NEW 1 1 HUMN/'` over all of `semantics.rs`. It also rewrote
three existing tests whose fixtures give a leader. One of them
(`a_formed_unit_pays_a_study_fee_for_the_men_it_was_given`) then failed. It read as a regression
from the fix and took a revert-and-rerun to bisect.

**Why.** The substitution was not scoped to the lines just written.

**Cost.** About ten minutes and one misleading failure.

**Prevent by.** For an edit to a new test in a 70k-line file, make an exact-match replacement that
asserts a count of one (an Edit, or a script that checks `count == 1`), never a file-wide `sed`.
Before any commit, `git diff | grep '^-'` over test files shows any existing line touched by
accident.

**Seen before.** none found.
