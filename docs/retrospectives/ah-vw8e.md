# ah-vw8e — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-26
- **PR:** #735

## The plan's Round 3 Q1 scenario used order syntax `SELL` does not accept

**What happened.** The plan's *User-facing decisions*, Round 3 Q1, and increment 10's test
`a_sale_its_own_except_emptied_does_not_warn` both illustrate "a line its own `EXCEPT` emptied"
with `SELL ALL FUR EXCEPT 3`. Building that as a `review_turn` test produced a
`unit-does-nothing` finding and zero income instead of a priced sale: `SELL`'s grammar
(`crates/core/src/orders/grammar.rs`) has only two forms, `[Kw("ALL"), Item]` and
`[Number, Item]` — no `EXCEPT` arm — so the order fails to parse entirely. `pnpm run atlantis
rules sell` confirms the real rule text: `SELL [quantity] [item]` / `SELL ALL [item]`, no
`EXCEPT` form at all (only `GIVE`/`TAKE` take one). The scenario the plan's design discussion
was built on cannot occur through real input.

**Why.** The plan's Round 3 Q1 correction ("my round-1 case table said `SELL ALL FUR EXCEPT 3`
twice warns on the second line; that was wrong and the navigator was shown the correction") shows
the scenario was reasoned about and even revised once, but never checked against `rules/sell` or
this repository's own `grammar.rs` — both of which would have shown `SELL` cannot take an
`EXCEPT` clause. The design *rule* that came out of the discussion (a line warns only when the
unit holds none of the goods when it runs, not merely when it sells nothing) is correct and
already covered by other increments; only the illustrative syntax was wrong.

**Cost.** One failed test run and about 10 minutes tracing why the order was silently dropped
before the rules lookup made the cause obvious. No CI cycle spent — the dropped test was never
committed as it stood; the underlying arithmetic stayed covered by increment 1's
`price_sale_line_resolves_all_against_what_is_left`, which exercises `Amount::All { except }`
directly rather than through order text.

**Prevent by.** When a plan's *User-facing decisions* or test-plan section quotes literal order
text for a specific game order (`SELL`, `BUY`, `GIVE`, …), the `atlantis-rules` skill's own
opening line applies to it too: look the order's grammar up (`pnpm run atlantis rules <order>`)
before using it as a test fixture, not only before writing a rules claim in prose. A planner
citing an illustrative order string is making the same kind of claim about the game as a
sentence in a bead description, and should be held to the same "always look it up" bar.

**Seen before.** None found.

## Increment 4's and increment 5's tests were only independently green once both were implemented

**What happened.** The plan's increment 4 test (`a_doubled_sale_never_moves_more_than_the_settled_share`,
a wanted line of 6 furs, two units holding 10 each, one doubled) states an expected income of 126
(3 furs). Implementing only increment 4's ledger-side fix (the running `Ledger::sold` total) left
`market_shares_for`'s claim uncapped, so the doubled unit's settled share computed to 4 (168), not
3 — the 126/3 figures only hold once increment 5's claim cap (`market_shares_for`'s `claimed` map)
is also applied. Separately, increment 5's own test as described ("assert no
`region-pool-oversubscribed` finding fires") does not hold for its stated fixture (wanted line of
10 furs, both units holding 10): two units genuinely capable of supplying 10 each against a pool
of 10 are genuinely oversubscribed (20 > 10) even after the claim-cap fix removes the bug's
inflation from 30 to 20, so the finding is correct to keep firing.

**Why.** Not established for the first point beyond the arithmetic itself: the ordering in the
plan's *Increments* section treats 4 and 5 as separable steps each gated by their own `cargo test`
run, but the specific numbers chosen for increment 4's test fixture already presuppose increment
5's fix. For the second point: not established whether the "no finding fires" line was a
transcription slip from a different, single-seller illustration (where a lone unit's own doubled
claim against a pool it alone contends for genuinely stops overrunning once capped) or simply not
re-checked against the two-seller fixture actually written into the increment.

**Cost.** About 20 minutes: one `cargo test` run to discover the 168-vs-126 mismatch, implementing
increment 5 immediately alongside increment 4 rather than strictly sequentially, and one further
`cargo test` run to discover the still-firing oversubscription finding and rewrite that assertion
to check the corrected total (30 → 20) instead of the finding's absence. No CI cycle spent — both
were resolved before the first push.

**Prevent by.** When a plan states two increments as independently testable but one increment's
test fixture numbers depend on arithmetic only a later increment introduces (here: a settled
*share* value that only becomes correct once the claim itself is capped), name that dependency
explicitly in the increment text — e.g. "this test only goes green once increment 5 also lands" —
so an implementer runs them together by design rather than by discovering a mismatch. And a
`region-pool-oversubscribed` (or similar "no finding fires") assertion in a plan is itself a claim
about the fixture's arithmetic and is worth computing by hand (or against `split_pool`'s own
`wanted > pool` gate) before being taken as the increment's acceptance, the same way a game-rule
claim would be.

**Seen before.** None found.
