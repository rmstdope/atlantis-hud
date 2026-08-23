# ah-ycuj — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-23
- **PR:** #602

## The plan's deliberate break proved nothing, because the corpus never exercises it

**What happened.** The plan's *Validation* section required proving the new corpus test had teeth by
temporarily deleting the `Intent::Pillage` arm of `forecast_unit`, since `ah-abwx` had already fixed
the divergence the bead was filed around. I did exactly that. All three tests stayed green. No
committed fixture's *orders template* contains a `PILLAGE` order — the word appears in five report
bodies, never as an order — so that arm is dead code as far as the corpus is concerned. Breaking the
`STUDY` charge instead failed immediately and usefully, naming fixture, unit, hex and every term.

**Why.** Established. The plan chose the break from the bead's history (the pillage divergence) rather
than from what the corpus actually contains, and nothing checks the two against each other. A
divergence that once reached a player is not evidence that a committed fixture reproduces it.

**Cost.** About fifteen minutes and two full rebuilds, plus the risk — which is the real cost — of
having concluded "proved" from a break that could not fail. Had I stopped at the plan's break I would
have merged a test whose sharing half asserted nothing at all, which is exactly what happened next.

**Prevent by.** When a plan names a specific production line to break as a teeth-proof, it should also
name the fixture and unit the break is expected to fail on. Absent that, the implementer must confirm
the break actually fails before trusting it, and pick another when it does not — a break that leaves
the suite green is a finding about the test, not a formality. Worth a line in `implement-bead`'s
*Validation* handling: **a teeth-proof that passes is a failed teeth-proof.**

**Seen before.** `ah-bet5` records a deliberate breakage going wrong in a different way (reverting it
with `git checkout` discarded uncommitted work). Same technique, different failure; no earlier file
describes a break that could not fail.

## A corpus assertion was vacuously true for 758 of the 1,392 units, and only the reviewer caught it

**What happened.** The hex-level half of the test — the assertion covering every sharing hex, which is
54% of the corpus's units — read the per-unit `not-enough-silver` findings. In a sharing hex silver is
a pooled tag, so `report_shortfalls` emits its shortfall through `hex.finding` with **no** `unit_id`
and never through the per-unit arm. Filtering on a present `unit_id` therefore dropped all 27
hex-level findings in the corpus, `any_warned` was structurally `false` for every sharing-hex unit,
and `!any_warned || sum < 0` could not fail. Copilot found it on the first review of #602. Probing
confirmed it exactly: 27 hex-level findings, 21 per-unit, zero per-unit in any sharing hex.

Tracking the pooled finding then exposed a second error underneath: the predicate the plan specified,
a flat sum of `B - U` over the hex's non-doubted units, is not the check's arithmetic. The purse is
the non-doubted **sharers**' balances and the claims on it are the non-doubted **non-sharers**'
overdrafts. The flat sum failed on `G3_F42_T40` hex `1:37,3`, which comes to +12 across eight units
while the pooled warning correctly fires.

**Why.** Established, and the two errors share one cause: I verified the assertion against the corpus
(green) instead of against a deliberate break. Increment 2's measurement — 758 divergences, all in
sharing hexes — even told me the sharing path was the dominant one, and I still proved teeth only on
the per-unit half. Green on real data is indistinguishable between "the code agrees" and "nothing was
compared", which is the whole reason the plan asked for a teeth-proof in the first place.

**Cost.** One review round and one CI cycle, roughly forty minutes. Nothing shipped wrong: the review
did its job. The counterfactual is what matters — the test would have merged looking like a guard
over 1,392 units while guarding 634, and the surface it silently stopped covering is the one that
carries most of the corpus.

**Prevent by.** Two specific things.

Where a test has more than one arm — an equality plus an exemption's replacement assertion — **each
arm needs its own teeth-proof**, not one for the file. A plan that specifies an exemption should
specify a break per arm. This one asked for a single break and got a single break, and the arm that
went unproven is the one that was broken.

And an assertion of the form "if X then Y" over a corpus should be accompanied by a floor asserting
**X actually occurs**, in the same commit. The `the_corpus_actually_exercises_the_agreement` test the
plan already asked for had floors for units compared, warned, `Doubted` and `SharedHex` — but not for
"a sharing hex is warned", which is precisely the one that was false. A floor per implication, not
per exemption. I have added that floor with a message naming this cause.

**Seen before.** None found. Grepping `docs/retrospectives/` for "vacuous", "teeth" and "deliberate
break" turns up `ah-bet5` and `ah-qled.4`, neither of which describes an assertion that could not
fail.
