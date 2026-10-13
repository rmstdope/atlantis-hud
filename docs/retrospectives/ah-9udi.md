# ah-9udi — retrospective

## A one-reader fix took six review rounds, because the SHARE pool's draw is read in eight places

**What happened.** The bead named one reader, the purse's cast moment (`Lending::settle`). That reader forgot a GIVE's draw on the SHARE pool once the giver received silver later in the Give phase. The first fix recorded the draw (`Ledger::silver_drawn_at_give`) and taught that one reader. Each later review round found another reader of the same figure that still netted the receipt against the draw:
- the column's credit clamp in `forecast_unit`;
- the Give-phase `SharerStock::at` that sizes later GIVEs (round 1);
- the cast moment charging the wrong sharer (round 2);
- `lend_walking_sharers_silver` (round 3);
- the readers of `WalkingSilver::departing`, which round 3's fix had changed the meaning of (round 4);
- `Sharing::silver_short_reading` (round 5);
- `Sharing::silver_short_carried_from_movement` (round 6).

Each finding was real and each fix was small, but every one cost a gate run and a review round.

**Why.** Nothing names the readers of "what a unit holds in a pooled hex at moment M". The ledger keeps lenders' rows untouched, and `Lending`, `SharerStock`, the walking-silver settlement, the warning readings and the column each rebuild the figure from those rows. `Lending`'s doc says it is "the one home" of what a sharer lent, but four of these readers did not go through it. So a new fact about the pool, here a draw made before the first purse moment, has to be taught to each reader separately, and only a reviewer probing case by case finds the ones missed. `share_pool_agreement` checks that some consumers agree. It did not catch any of these, because it does not cover the warning readers or the walking-silver figures.

**Cost.** About three hours of one bugfix session. That was six cold-read and follow-up reviews, seven fast-gate runs, and nine regression tests in place of one.

**Prevent by.** Before the first fix, list every reader of the figure the bug is about. For this one: `grep -n "silver_at(ledger" crates/core/src/orders/semantics.rs` plus the `departing` readers, with each reader checked against the bead's example. Do this in `fix-bug`'s contract step 2, "Reproduce with a test", as a sub-step for a bug in a figure several readers rebuild. Structurally, the existing `share_pool_agreement` test could be extended to the warning readings (`Sharing::silver_short_at`) and the walking-silver figures. Then one example run through it would have shown all six disagreements at once. That is a refactoring for Forge to weigh: one reading of a unit's pooled silver that every reader takes.

**Seen before.** ah-pf7t and ah-lnz4 record the same shape: several readers re-deriving what a sharer lent, which is what `Lending` was made the one home of.

## The same mechanism was built twice in parallel, again

**What happened.** While this PR was in review, ah-msds (#1560) merged "a GIVE's lending is booked on the sharer drawn on as it ran". It added `Ledger::gift_draws`, which is the same record this PR had built as two maps (`silver_drawn_at_give`, `silver_lent_at_give`), pre-booked into `Lending::settle` at the cast in the same way. The PR went `CONFLICTING`. It was rebuilt on main: my two maps were replaced by `gift_drawn_by`/`gift_lent_by` over `gift_draws`, and only the readers ah-msds had not reached were kept. Those are the column floor, the Give-to-Cast stock carry, the walking-silver net holdings, and the two warning floors. Five of this bead's regression tests, the bead's own example among them, were still red on main.

**Why.** ah-msds and ah-9udi were both filed from reviews of the same code (`Lending::settle`'s cast moment) and handed out at the same time. Nothing linked them. That is the shape ah-hreo's retrospective recorded the same day.

**Cost.** About forty minutes: reading ah-msds, porting the tests, rebuilding the fix on `gift_draws`, plus another gate and CI run.

**Prevent by.** As in ah-hreo: when `scripts/bugfix-candidates` hands out a bead, check the in-progress bugfix beads for one naming the same function, and hold the second until the first merges.

**Seen before.** ah-hreo (same day, same function), ah-eoag.
