# ah-jo6b.4 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-09
- **PR:** #1108

## The plan asked the ITEMS preview for an assertion it cannot make

**What happened.** The plan's end-to-end test asked
`preview_holding(&text, script, "2390", "ORC")` to read `0` orcs with an empty uncounted list for
the refused mage. The helper panicked with `the preview has unit 2390`, and a probe showed
`preview_orders_for_remembered_report` returning **zero regions** for that fixture — with any
skills, and even with the orders reduced to `unit 2390\n`. The preview carries a row only for a unit
whose month changes something, so a refusal that buys nobody and spends nothing leaves no row at
all. The test now returns `Option` and asserts `None`, with the control's `Some((5, []))` on the
same unit id and script proving the absence is real; the deviation is recorded in the PR body.

**Why.** The skip-the-row gate in `preview_orders_on_map` (`crates/core/src/orders/effects.rs`) —
the same gate `ah-rgkk.3.1` records widening. A plan that predicts a preview figure for an order
whose whole point is that it changes nothing is predicting a row that gate removes.

**Cost.** About fifteen minutes: one failing run, three probe iterations to find that the emptiness
was the fixture and not the change, and a rewrite of one helper.

**Prevent by.** A plan naming an ITEMS-preview assertion for a case whose expected outcome is *no
change at all* should say which row it expects to survive `preview_orders_on_map`'s skip gate, or
assert the absence of a row outright. The two ITEMS assertions worth writing for a refusal are "no
preview row" and "the control unit's row is unchanged" — not "the row reads zero".

**Seen before.** `ah-rgkk.3.1` — the same gate, from the other side: a widening that added rows a
test did not expect. `ah-3ej` mentions the preview but on an unrelated point.
