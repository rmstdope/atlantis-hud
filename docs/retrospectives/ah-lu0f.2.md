# ah-lu0f.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-24
- **PR:** #664

## A test fixture held one item under two lines, and the two silver surfaces read it differently

**What happened.** With the market settlement threaded into the ledger, the pre-existing
`a_sale_pays_what_the_market_wants_to_pay` went red: a unit written as holding 10 grain sold 1. The
arithmetic looked wrong in the new code. It was not. `unit()`
(`crates/core/src/orders/semantics.rs`, test module) already gives every fixture one `GRAI`, and
`with_item` *pushed* a second line rather than replacing it — so the fixture carried two `GRAI`
lines, 1 and 10. `Ordered::holding` takes the **first** match and answers 1; the ledger's balance
map is built by inserting each item by tag, so the **last** write wins and it answers 10. Two
production functions disagreeing about one number, and only a fixture that could not occur in a
real report made it possible.

**Why.** Established. `holding` uses `.find()`; `ledger_for`'s balance map uses `insert()` on a
`BTreeMap` keyed by tag. Neither is wrong on its own, and nothing read both quantities for the same
tag until this bead did — so the fixture's duplicate line was invisible for as long as it existed.

**Cost.** About 25 minutes, most of it spent instrumenting `market_shares_for` and `split_pool`
under the assumption the new settlement lookup had the wrong unit index. Zero CI cycles: it was
caught by the local gate.

**Prevent by.** The fixture helper now replaces a line for the tag, which removes this instance.
The general shape is worth a check rather than a rule: nothing asserts that a `ReportUnit`'s
`items` carries a tag at most once, and a parser fed a malformed report could produce one. A debug
assertion in `Hex::read`, or a `holding` that sums matching lines instead of taking the first,
would make the two surfaces agree by construction. That is a change outside this bead and is the
navigator's to weigh.

**Seen before.** None found — no retrospective in this directory mentions `with_item` or a
duplicate item line.
