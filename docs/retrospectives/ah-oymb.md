# ah-oymb — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-09
- **PR:** #1141

## A plan that enumerated call sites by reading missed one, and only a debug assertion found it

**What happened.** The plan's whole design was "one shared resolver, so the divergence is
unrepresentable", and it named the call sites exhaustively: `market_answer`, `market_shares_for`,
`check_region_pools`. It stated as established fact that "both consuming surfaces read the one
settlement". There is a fourth site — `forecast_hex`'s `market_share` closure
(`crates/core/src/orders/semantics.rs`, ~line 1611) — which resolved the item itself with bare
`resolve_item` before looking the share up. With the plan's three fixed and the fourth left alone,
both new `check`-level tests failed inside `silver_records_agree`: the SILVER column priced the
whole ask (`-400`) while the ledger priced the settled share (`-200`).

**Why.** The plan found its three call sites by reading `resolve_item`'s callers in the market
functions. The fourth is not in a market function — it is a closure inside the SILVER column's
per-unit loop that resolves a tag before a map lookup — so it does not read as a market resolver and
a reading pass does not surface it. `grep -n 'resolve_item(' crates/core/src/orders/semantics.rs`
shows it in one line.

**Cost.** About ten minutes: one failing test run, locating the closure, and one extra hunk. Small
only because the `silver_records_agree` debug assertion exists and fires loudly — without it the
change would have shipped with the two surfaces disagreeing on exactly the orders the bead was
fixing, and nothing else in the suite would have caught it.

**Prevent by.** A plan whose design is "one shared resolver" should include, in its *Validation*
section, the grep that proves the enumeration is complete — here
`grep -n 'resolve_item(' crates/core/src/orders/semantics.rs` — and an implementer should run it
before the first increment rather than trusting the prose list. This bead's plan did ask for that
grep, but only as acceptance criterion 5, checked after the change; run first it would have found
the fourth site before a test failed.

**Seen before.** None found. `ah-t2pn.3` touches the same three symbols (`Lookups::market_share`,
`market_shares_for`, `forecast_hex`) but records a different finding.
