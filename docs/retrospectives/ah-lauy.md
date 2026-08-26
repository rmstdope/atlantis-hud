# ah-lauy — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-26
- **PR:** #739

## The plan's own pseudocode would have failed its own listed test

**What happened.** The plan's *Files to change* section 4 gave `settle_buy_all` this dead-buy
condition, quoted directly:

```rust
if plan.bought == 0 && already > 0 {
    ledger.dead_buys.push(DeadBuy { ... });
}
```

Implemented literally, this fires a false `nothing-left-to-buy` warning whenever a *second*
`BUY ALL` of the same goods happens to be stopped by an empty purse rather than by the market
share the earlier line took — because `bought == 0 && already > 0` is also true in that case, even
though `price_buy_all`'s own `capped_by` correctly reports `Silver`, not `AlreadyBought`. The
plan's own test-plan table lists exactly this case,
`a_buy_all_stopped_by_silver_does_not_warn` ("the market still has stock; nothing was bought
twice; the shipped silver sentence stands and no finding fires"), and out-of-scope explicitly
calls it out too. Writing that test against the plan's literal pseudocode failed it immediately.

**Why.** The pseudocode's `already > 0` guard is a coarser test than `capped_by ==
BuyAllCap::AlreadyBought` — the two only coincide when the earlier line actually emptied the
share (`left == 0`). Once a second line's own silver is *also* exhausted (a realistic case: the
first line's purchase spent most of the purse), `bought == 0` no longer distinguishes "the market
share is used up" from "the purse ran dry," but `already_bought`'s presence alone can't tell them
apart — only `price_buy_all`'s own cap decision can.

**Cost.** About 15 minutes: one failing test, tracing the arithmetic by hand, and rewriting the
condition to gate on `plan.capped_by == BuyAllCap::AlreadyBought` instead of `already > 0`. No
extra CI cycle — caught before the first push.

**Prevent by.** When a plan's design section computes a value (`capped_by`) specifically to
distinguish two causes, a later section's pseudocode that re-derives "was it cause A" from a
narrower signal (`already > 0`) is worth double-checking against the plan's own test-plan table
before implementing verbatim — the exact test that would catch the gap is often already listed
there, as it was here.

**Seen before.** none found.
