# ah-s4hy — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-17
- **PR:** #1670

## Cutting a buyer's market share to its purse turned 59 unrelated tests red

**What happened.** The first version of the purse cap capped each buyer's share at what it could
pay. That gave the right quantities, and `cargo test -p atlantis-hud-core` went from green to 59
failures in not-enough-silver, cut-buy, BUY ALL cap and item-movement tests, all far from the
market split being fixed.

**Why.** One per-unit market share (`HexStanding::market_share_of`, and the SILVER column's
`Lookups::market_share`) answers two questions: how many goods the buyer gets, and what its order
is charged against (`quantity_bought(count, allowed)` gives the "wanted" figure that
`not-enough-silver` and `short_for_orders` bite on, and `price_buy_all` reads a share below the
line as `BuyAllCap::Shared`). A share cut to the purse can never exceed the purse, so every purse
warning went quiet. The fix was to divide by the purse-cut claims, then raise a buyer that got all
it could pay back to what the line leaves it (`leave_the_line_to_whoever_got_all_it_can_pay`).

**Cost.** One full red suite and a redesign of the fix, about twenty minutes. The reviewer's
finding 1 (raised shares can sum past the line) is a consequence of the same double meaning.

**Prevent by.** A doc line on `market_share_of`, and on the `market_share` field of `Lookups` in
silver.rs, saying a share is also the ceiling an order is *charged* against, so it must never be
cut by the unit's own purse. Better still, split it into a goods share and a charge ceiling, which
is a Forge question.

**Seen before.** None found. ah-lu0f.2 and ah-t2pn.3 touch the market settlement, but not the
share's double meaning.
