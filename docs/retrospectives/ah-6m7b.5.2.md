# ah-6m7b.5.2 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-09
- **PR:** #1123

## An increment's whole premise was a measurement the plan had not taken

**What happened.** The plan's increment 3 was a `debug_assert` in `forecast_hex` holding the SILVER
column's change list and the ledger's new record to each other, term for term, with three named
exclusions. It was built as specified. `cargo test -p atlantis-hud-core` then failed on about twenty
fixtures in **five** distinct classes: `Taxed` amounts differing by construction (416 against 500,
five fixtures, and 250 against 500 — `credit_tax` prices with `tax_base.unwrap_or(i64::MAX)` and
`PoolShare::Uncontended` while the column passes the real figures); `Studied` differing by headcount
(-50 against -150, and four more — the ledger prices off `actor.unit.men`, the column off the late
headcount); a `TAKE`'s source unit carrying a ledger row the column never records; a formed unit the
column forecasts and the walk has no record for; and the column omitting a `Bought` row the ledger
records. Making it pass would have meant excluding `Taxed`, `Studied`, `Bought` and outbound
`GaveAway` — most of what the check exists to compare — so the shape of the check, not a detail of
it, was wrong. The navigator chose to ship the first two increments and file the third as
`ah-6m7b.5.3` with the measurements in it.

**Why.** The plan named two of the five classes itself, in *Known traps*, and waived each on a claim
about what the column does in that case: of `Taxed` it said "the column doubts in exactly those
cases and `changes` is emptied, so the check does not see it". That is false — a contended pool
yields a *number*, not a doubt. The plan reasoned about the check's output without running it, and
the check is precisely the kind of thing whose output cannot be predicted by reading: it compares
two large surfaces over every fixture in the crate.

**Cost.** About forty minutes — building the check, running it, classifying the five failure classes
well enough to put a question rather than a guess to the navigator, and then withdrawing it. Not
wasted: the measurements are `ah-6m7b.5.3`'s content, and building the check caught the defect below.

**Prevent by.** A plan whose increment is *a new assertion over an existing corpus* should say so and
be planned as a measurement rather than as a build: the planner runs the comparison — a throwaway
`debug_assert` and one `cargo test` is all it takes here — and writes the exclusion list from what it
finds, instead of deriving one from what the two surfaces are believed to do. `plan-bead`'s *Known
traps* already asks for line numbers to be re-read on the branch; this is the same rule applied to a
claim about *behaviour*, and `ah-6m7b.4`'s retrospective from the same day makes the same point about
a universally-quantified claim cited to a test that did not make it.

**Seen before.** `ah-6m7b.4` — same epic, same day, same class: a plan waiving a guard on a claim
about a corpus that the cited test did not support. `ah-nass`, `ah-8m0.3` and `ah-y9hx` are the
nearer misses on cited-test claims.

## The plan named the wrong test for a distinction, and only the withdrawn check found it

**What happened.** The plan specified `transfer`'s outbound silver cause as `Discarded` when
`to.is_none()` and `GaveAway` otherwise, saying in as many words that this is "the same test the
column makes". It is not. `to` is `None` both for a `GIVE 0` and for a gift to a target the report
shows in no region, and only the first is a discard, so a gift to an unreachable unit was recorded as
a discard. The correct test is `reach == GiveReach::Discard`, which `settled_gifts` five lines below
already uses for its own `to_nobody` field. It surfaced as
`a_gift_to_a_unit_in_no_region_says_so` failing under increment 3's check, with the column saying
`GaveAway` and the record saying `Discarded`.

**Why.** Nothing else in the bead would have caught it. The unit tests written for increment 2 cover
`GIVE <n>` and `GIVE 0`, which are the two cases the plan's test gets right; the third case needs a
target the report does not place. The check found it in the ten seconds before it found twenty
things that were not defects.

**Cost.** Nothing on its own — two minutes once the check was running. It is recorded because of what
it says about the first finding: the withdrawn increment paid for itself.

**Prevent by.** `implement-bead` already says a helper the plan cites for what it decides is read
before it is built on. This was not a helper but a *predicate written inline*, cited to another
surface — "the same test the column makes" — and the same rule should reach it: where a plan says a
condition matches one another surface makes, open that surface and compare the two conditions before
writing the first one.

**Seen before.** None found for this exact shape; `ah-6m7b.4` is the nearest, for the cited-claim
family.
