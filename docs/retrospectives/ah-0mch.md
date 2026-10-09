# ah-0mch — retrospective

- **Implementer:** Shadowcat
- **Date:** 2026-10-09
- **PR:** #1465

## A sharer's stock was lent twice, and the first fix's tests could not see it

**What happened.** The first push made GIVE, CAST and SELL clamp to "own plus the other sharers'
balances", with one regression test per case, all green. The cold-read review then found three
blocking cases, each with two spenders in one hex: a sharer's swords given by unit 1 and then again
by the sharer itself, two mages casting on one sharer's 300 silver, a giver holding none of the
item. The follow-up review found a fourth: a sharing caster whose purse a borrower had already drawn
on. Every one of them was a second reader of a balance the first spend had not reduced.

**Why.** The hex ledger in `crates/core/src/orders/semantics.rs` charges a borrower the *whole* of
what it spends and leaves the lender's row alone. The silver purse is netted from overdrafts at the
month's end (`sharing_purse`, `Lent`/`WasLent`), and the BUY path adds a cut line back through
`Ledger::overcharged`. So a sharer's balance at a phase is not what it still has to lend. Nothing
at `PhaseState::balance_at` or `Sharing` says so, and every test this bead first wrote had a single
spender, where the two readings agree.

**Cost.** Two extra review rounds and fix pushes (about forty minutes), and a redesign of
`shared_num_at` into a whole-pool reading with a new `Ledger::unfunded` add-back.

**Prevent by.** A doc paragraph on `Sharing` (semantics.rs) stating that lenders' balances are
never debited when a borrower spends, and that "what a sharer can still lend" must be read through
`shared_num_at`. Also a line in `.cerebro/traps.md` that any test of a SHARE rule needs a second
spender drawing on the same sharer.

**Seen before.** None found.
