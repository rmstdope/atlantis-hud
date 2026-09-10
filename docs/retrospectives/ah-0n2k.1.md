# ah-0n2k.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-10
- **PR:** #1160

## The plan listed the gates on a new flag, and the list was one question short

**What happened.** The plan's *Decided by me* said the bound is set "**Bounded only where the term is
a number and only where the unit draws on the pool**, from the same two predicates the `Unknowable`
doubt is raised from" — two gates, named as the complete set, with the reassurance that this "is what
makes the mockup's *Both kinds of trouble* and *Your unit is not earning here* rows fall out rather
than be coded twice". It also specified the flag as one hex-wide `PoolShares::unread_claimant: bool`.
Both gates were correct; there was a third the plan never asked about — **does the pool exist, and
does it hold anything?** — and it cost two more review rounds to find, one case wider each time:

- Round 1 found three cases where a stated pool is absent: `max_wages: None` (the region states no
  ceiling, so a worker's wage is exactly what it asked for), `entertainment: None` (`late_income` is
  `Some(0)`, so the row read `0 at most`), and `region.pillaged` (the tax base is filtered out of the
  settlement, so every taxer collects a certain nothing — while `taxed-a-pillaged-hex` was telling
  them so).
- Round 2 found the same defect one case wider: my fix guarded on `pool.is_some()`, and
  `Entertainment available: $0.` parses to `Some(0)`, not `None`. So `0 at most` — the exact string
  round 1 had called false — was still reachable from an ordinary report.

The one hex-wide boolean was the other half of it: `draws_late` ORed `is_set_to_work` with
`Intent::Work | Intent::Entertain`, so a worker in a region with no wage ceiling but a finite
entertainment demand was bounded off the wrong pool. Per-pool flags set inside the settlement's own
`for Contended { … }` loop made both defects fall out together, and made the new code mirror the
`Unknowable` doubts immediately above it instead of diverging from them.

**Why.** The plan derived its gates from the `Unknowable` doubt's predicates, which are about the
*unit* (does it work, does it entertain, does it tax). The question it never asked is about the
*pool*, and the settlement loop is the only place that knows the answer — which is exactly where the
`continue` for an unstated pool already lives, eight lines from where the plan put the new field.

**Cost.** Two extra CI cycles and two extra review rounds, about 35 minutes of the roughly
two-and-a-half hour run. No rework of the interface: every string, state and test on the TypeScript
side was untouched by all of it.

**Prevent by.** When a plan adds a flag that qualifies an existing computed value, its
*Decided by me* should state the gates as a question about **each input to that value**, not only
about the unit — here: "is there a pool, does it hold anything, does this unit draw on it, is the
term a number". A list of gates presented as complete is trusted as complete; the giveaway that this
one was not is that the plan put the new field on `PoolShares` while the fact it gated on
(`pool.is_some_and(|p| p > 0)`) is a local of the loop that fills `PoolShares` in. Where a plan
places a flag one scope away from the fact that qualifies it, that is worth reading as a sign the
gate list is short.

**Seen before.** `ah-048` — the same species one level down: a plan named a predicate as the test
for something and the predicate answered a narrower question than the plan believed. There the fix
was to read the cited function's own doc comment; here it is to check that the *set* of gates covers
every input, not that each named gate is right.

## The plan's Increments section stopped at 3, and its Test plan referred to 7

**What happened.** The plan wrote out increments 1–3 (the Rust core and its integration test), then
its *Test plan* named "increment 4", "increment 5", "increment 6" and "increment 7" against the four
TypeScript test files. Those four increments were never written. I built them from *Files to change*,
which specifies each of the four completely — the two helpers, the `atMostIf` local, the three
changed hover rows, the new `SILVER_NOTES` entry, `silverTotalLine` and `silverFigure` — so nothing
about approach, scope or what a person sees had to be decided here, and it was recorded as a
deviation in the PR body rather than handed back.

**Why.** Not established. The two sections are internally consistent about *what* to build and
disagree only about whether the TypeScript work was enumerated as increments.

**Cost.** Small — a few minutes deciding whether a plan whose *Increments* section is present but
short of what its own *Test plan* cites counts as a missing mandatory section. It does not, on my
reading: the section exists and *Files to change* leaves nothing open.

**Prevent by.** `implement-bead`'s hand-back rule turns on a mandatory section being *missing*, which
does not cover a section present but internally inconsistent with another. Either the planner's
checklist should assert that every increment its *Test plan* cites by number exists in *Increments*,
or `implement-bead` should say plainly that a plan whose other sections fully specify the work is
built rather than handed back. One sentence in either place removes the judgement call.

**Seen before.** None found — `grep -rln "increments 4\|Increments section" docs/retrospectives/`
finds nothing of this shape among 358 files.
