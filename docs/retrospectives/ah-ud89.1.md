# ah-ud89.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-09
- **PR:** #1127

## The plan's load-bearing invariant test was vacuous, and only the reviewer's mutation found it

**What happened.** The plan named one test as the family's load-bearing assumption, in as many words:
"if this test fails, stop, the bead goes back through `human`." I wrote it as specified —
`pool_shares_for(hex, region, None, …).shares[i].tax == pool_shares_for(hex, region, Some(&phases), …).shares[i].tax`
— it passed, and I moved on. The review sub-agent mutated `taxing_men` in exactly the way the
invariant exists to catch (`_ => facts.men` to `_ => facts.maintenance().men`) and the test stayed
green: the fixture was two plain taxers with no gifts, market or production, so the two phase
pictures were identical and `Some(&phases)` versus `None` was a no-op whatever the code read. The
fix was a fixture that recruits in the market, plus a second assertion that the two pictures do
differ in the headcount the tax term would read.

**Why.** The plan specified the *assertion* and left the fixture to the implementer, and an
assertion that two readings agree is trivially satisfied by a fixture where the readings cannot
differ. Nothing in the plan or in `implement-bead` asks whether a passing test could have failed.

**Cost.** One review round and about 25 minutes. Cheap only because the reviewer ran the mutation
rather than reading the test.

**Prevent by.** `plan-bead`'s *The test plan*: where a plan names a test as pinning an invariant —
especially one whose failure it says must stop the bead — it should state what the fixture must
**differ** in, not only what the assertion must compare. The narrow, checkable form: a test asserting
that two readings of the same thing agree needs a fixture in which they could disagree, and the test
should assert that too. `implement-bead`'s *The review loop* could also say plainly that a
first-round reviewer given a plan-mandated invariant test is expected to try to break it.

**Seen before.** `ah-1wcw.1` — a plan asking for a test its own fixture could not support, the
opposite direction of the same gap between a plan's assertion and its fixture.

## The plan's acceptance criteria contradicted its own behaviour table

**What happened.** Acceptance criterion 4 said `crates/core/tests/phase_silver_for_a_cast.rs` must
pass **unmodified**, "if one had to be edited, the `charged` rule is wrong". That file's
`a_contended_tax_funds_the_cast_the_items_column_already_makes` asserts `cast_made == 1` on a
contended $300 pool — which is precisely the defect the bead's own table says must become `0`. The
criterion could not hold. Separately, the same plan's `$100` table row asked for `Out 0`, which its
own `charged` rule makes unreachable and which the parent bead's *Agreed with the navigator*
contradicts in as many words.

**Why.** Not established. Both look like the plan's acceptance section being written from the
intended shape of the change rather than from a grep of what currently asserts the old behaviour.

**Cost.** About 20 minutes, most of it deciding whether editing a shipped test was a hand-back
(approach) or a detail (mine). It was a detail — the table and the parent's interview both said so —
but that judgement is exactly the kind an implementer should not have to make twice.

**Prevent by.** `plan-bead`: before writing "this shipped suite must pass unmodified", grep the
suite for what asserts the behaviour being changed. A criterion naming a file that asserts the
defect is a criterion that cannot be met, and it puts the implementer in the position of choosing
between two halves of its own plan.

**Seen before.** `ah-sdjy`, `ah-rgkk.2.1` — acceptance criteria that could not be satisfied as
written.

## A unit the ITEMS preview has nothing to say about is absent from it, not present with a zero

**What happened.** After the change, `preview_orders_for_remembered_report` returned **zero regions**
for the contended fixture: the mage now creates nothing, the other unit only taxes, so there is
nothing to preview. Both the new integration test and a shipped one panicked on
`find(|unit| …).expect("the preview has the mage")`, which reads exactly like a crash or a broken
fixture rather than like the correct new answer. I spent a stash-and-rebuild cycle establishing it
was not a regression.

**Why.** The preview carries changed units only. Nothing in the plan or in the existing tests says
so, and every prior test of this surface happened to be about a unit that did change.

**Cost.** About 15 minutes, plus one baseline rebuild.

**Prevent by.** Assert an amulet count by summing over a `filter`, never over an `expect`ed `find` —
and pair it with a positive anchor elsewhere, since `0` is also what a broken fixture gives. Worth a
line in `.cerebro/traps.md` if it bites `ah-ud89.2` or `.3`, which touch the same surface; it is
recorded in those beads' notes already.

**Seen before.** none found.
