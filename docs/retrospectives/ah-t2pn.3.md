# ah-t2pn.3 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-23
- **PR:** #624

## The plan's six increments could not be built one at a time, so four of them never went red

**What happened.** The plan lists six increments, each with its own RED test. Increment 1 ("two
sellers split what the market wants") cannot be made green without adding `MarketSide`,
`Lookups::market_share`, `market_shares_for` and the wiring in `forecast_hex` — and adding a field
to `Lookups` means touching every arm that reads it. Increments 2, 3 and 4 (the two `BUY` arms) were
therefore already implemented by the time their tests were written, and passed on arrival. Only
increments 1 and 5–6 behaved as the plan describes; 5 and 6 are regression nets, which are meant to
pass.
**Why.** The increments are split by *behaviour observed* (selling, lone buying, contended buying,
`BUY ALL`) but the code is split by *structure* — one closure threaded through one struct into three
arms. A behavioural split cannot drive a structural change incrementally: the first behaviour pays
for the whole structure.
**Cost.** About ten minutes, spent reverting each `BUY` cap in turn to confirm the three tests
genuinely fail without it. Not wasted — that check is what makes the tests evidence rather than
decoration — but it was unplanned work, and an implementer that did not do it would have shipped
four tests it had never seen fail.
**Prevent by.** Where a plan's first increment must introduce a shared structure (a new field on a
struct several arms read, a new closure on `Lookups`), name that structure as its own increment 0 —
"add `market_share` to `Lookups`, every caller falling back to today's figure, no behaviour change" —
and let the behavioural increments follow. Where that is not natural, the plan should say outright
that the later increments will pass on arrival and that the implementer is expected to verify them
by reverting the change, so the verification is planned work rather than a judgement call made at
the gate.
**Seen before.** `ah-dlao` — a different cause (a plan describing a trap that did not exist), but
the same symptom and the same remedy: a test that cannot go red is not yet evidence, and reverting
the fix is what settles it. Second sighting of that remedy earning its keep.
