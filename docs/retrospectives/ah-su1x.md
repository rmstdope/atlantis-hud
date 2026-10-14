# ah-su1x — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-13
- **PR:** #1528

## A spend sized on a lender's ledger balance shipped silver the SHARE purse had already lent, and each re-derived fix was wrong a new way

**What happened.** The bug: `Ledger::transport_holding` sized a sharer's `TRANSPORT ... ALL SILV`
from its ledger balance, which still held silver the purse had lent to a hex-mate's BUY. The first
fix took off a market-only figure (`MarketPurse::lent_by`); the cold-read review found a STUDY the
same sharer paid for still shipped. The second fix re-derived the lending as a flat
`SharerStock::drained` at `StatePhase::Transport`; the follow-up review found that it booked a
refused STUDY as a loan and drained a sharer that had walked away. The third reused
`sharing_purse`'s own moment loop (extracted as `lend_at_moments`) and was right, bar the netting
of lends against borrows, which the third review found and which `sharing_purse` already did.

**Why.** The ledger charges a borrower the whole of what it spends and leaves the lender's row
alone, so "what a sharer still has" exists only as `sharing_purse`'s settlement. Each fix that
re-derived that settlement instead of calling it dropped one of its rules (the moments, the staying
pool, the all-or-nothing cut, the netting). Nothing at `transport_holding`, or at
`PhaseState::balance_at`, says that a lender's balance overstates what it holds.

**Cost.** Three review rounds and three fix pushes, about an hour, and two CI cycles beyond the
first.

**Prevent by.** A doc paragraph on `PhaseState::balance_at` (semantics.rs) saying that a SHARE
lender's balance includes what it lent, and that a reader sizing anything on a sharer's silver must
take off `Ledger::lent_before_transport` or call `lend_at_moments`, never re-derive the lending.
The `.cerebro/traps.md` line `ah-0mch` proposed (a SHARE test needs a second spender drawing on
the same sharer) would have caught the first fix too.

**Seen before.** ah-0mch (a sharer's stock lent twice: second readers of a balance the first spend
had not reduced).

## Verification failed: the fix's fixtures never paid upkeep in silver (second pass, PR #1568)

**What happened.** The first pass merged green and failed verification. In the navigator's real
hex the taxer paid its upkeep in silver and the buyer WORKed, and the buyer was still shown short
for its BUY, with phantom upkeep relief "paid by a faction-mate". Every first-pass test built the
taxer with `with_men_grain`, and the default `unit()` fixture feeds itself too. So no unit in those
tests paid upkeep in silver, and maintenance step 4, which reads the ledger balance without the
purse's loans, was never exercised.

**Why.** The fixture default is deliberately silver-neutral (the comment on `unit()` says so), which
is right for most tests but hides every interaction between SHARE lending and maintenance. Nothing
prompts a SHARE test to also try units that pay upkeep in silver.

**Cost.** One failed verification (a navigator sitting), the bead reopened at P0, and a second
full pass. A local slip in the second pass cost one extra gate run: `cargo test | head` hid a
failing integration binary, because cargo stops at the first failing binary without
`--no-fail-fast`.

**Prevent by.** A paragraph on `sharing_taxer_hex` and on `unit()` in semantics.rs's tests: a test
of SHARE silver must include at least one case built with `starving` (upkeep paid in silver) and a
borrower with late income (wages), since maintenance step 4 judges upkeep after the purse has lent.
For a local run of the whole crate, use `cargo test -p atlantis-hud-core --no-fail-fast`.

**Seen before.** The first section of this file: a second reader of a lender's balance (there
TRANSPORT, here maintenance) that the purse's lending had not reduced.
