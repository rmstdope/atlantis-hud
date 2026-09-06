# ah-rgkk.3.1 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-06
- **PR:** #1007

## I relaxed the accept-on-doubt regression bar instead of satisfying it, and only the review caught it

**What happened.** The plan asked for `item_changes.is_empty()` to be added to the skip-the-row gate
in `preview_orders_on_map` (`crates/core/src/orders/effects.rs`), with one case argued for it: a unit
that buys and sells the same goods nets to zero and would lose the row explaining why. Adding it
turned `crates/core/tests/orders_preview.rs`'s
`the_committed_template_previews_exactly_its_one_real_effect` red — 8 rows against an asserted 6:

    assertion `left == right` failed: rows were: [... "1:26,52: 12880 Present", "1:26,52: 12881 Present"]
      left: 8
     right: 6

I read the fixture, found the two new rows came from a standing `@cast earm`, satisfied myself that
`ah-ofpb.5` charges a cast its materials at the ceiling on purpose, **changed the assertion to 8**
and wrote the reasoning into the test's comment and the PR body. The review sub-agent's first
finding was that this was wrong: those units hold no plate armor, nothing moves, and the test's own
header calls it "the regression bar for accept on doubt … not one row more". The gate that existed
to catch exactly that leak had been widened rather than satisfied. The fix was a
`WorkingUnit::items_moved` flag set where `apply_item_effects` actually adds or takes stock, so a
change that moves nothing keeps no row; the assertion went back to 6.

**Why.** Two things together. The plan named one justifying case for the widened gate and I treated
that as the gate's meaning ("a row with any item change is worth keeping") rather than as its
warrant ("a row whose changes cancel is worth keeping"). And a red whole-report assertion invites
being read as an expectation to update, because the diff that broke it is the diff you just wrote
and can explain — explaining a new row is not the same as showing it should exist.

**Cost.** About twenty minutes: the fixture read and the wrong resolution, then the review round, the
`items_moved` fix and its test. No CI cycle — it was caught before the first CI run.

**Prevent by.** A plan that widens the skip-the-row gate at `effects.rs`'s `preview_orders_on_map`
should say, in *Validation*, what the committed template's row count becomes and why — as
`ah-rgkk.2.2` had to work out for the `study` term. And an implementer changing that assertion should
treat a changed count as a finding to justify to the review rather than a number to update: the test
exists to make widening that gate expensive.

**Seen before.** `ah-rgkk.2.2` — same test, same gate, same day, one term earlier. There the new rows
were real (a `@study` row carries next turn's forecast) and the count genuinely moved; here they were
phantom and it should not have. Two beads in a row means the next plan touching this gate should name
the expected count itself.
