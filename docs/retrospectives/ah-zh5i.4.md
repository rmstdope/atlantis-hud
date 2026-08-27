# ah-zh5i.4 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-28
- **PR:** #757

## The plan's opening RED was itself a race, and the first run of it passed

**What happened.** The plan's increment 1 opened with a header-invariance guard and said it
"fails **73 vs 102**" on unmodified `main`, adding that the header "was 73 at that point in every
run observed — both attempts of two instrumented runs and all three ticks-#0 of the sampling
probe". I added the guard exactly as written and ran the spec once with `--retries=0`: it
**passed**. Read literally, a plan that says "this will be red" and a red that is green says the
symptom is already gone — and this plan also warned, at length, that `ah-zh5i.2` would hide the
bead's other assertion, so "already fixed, hand it back" was the reading immediately to hand.

It was not fixed. A probe spec sampling the header every 100ms showed the chip landing between
100ms and 200ms after `selectHex` returns — so whether the `headerBefore` capture, one browser
round trip later, catches 73 or 102 is a coin toss. `--repeat-each=6` on the same unchanged code
gave **5 failed, 1 passed**, all five at `73 vs 102`. The plan's own diagnosis was right in every
particular; only its claim that the RED was deterministic was wrong.

**Why.** Established. The plan's measurements were taken with an instrumented spec that read the
geometry at four fixed moments, which changes the timing of the capture relative to the chip. The
uninstrumented guard sits closer to the boundary, so it lands on either side of it. The plan
generalised from a handful of runs of a differently-shaped test to "every run observed".

**Cost.** About twenty minutes: one wasted single-run interpretation, one probe spec written, run
and deleted, and one repeat run to establish the real rate. No CI cycles, and nothing was handed
back — but the outcome that was one step away was handing back a live bead as already fixed, which
would have cost a planner's pass and another implementer's session.

**Prevent by.** `plan-bead`'s *Increments* section should require that a failing test for a **race**
names the repetition needed to observe it — `--repeat-each=N`, with the observed failure rate — in
the increment itself, not only in *Validation*. This plan did put "ten consecutive green runs" in
*Validation* for the fix; the same reasoning applies with more force to the RED, where a single
green run is not weak evidence but actively misleading. Concretely: a plan whose *Context* explains
a symptom as a timing race must not describe its own opening RED with the word "fails" unqualified.

**Seen before.** none found. `ah-l9mp` is the nearest neighbour — three CI cycles spent on a
failure a branch update made vanish — but that is a symptom disappearing for a real reason, not a
plan overstating how reliably its own test fails.
