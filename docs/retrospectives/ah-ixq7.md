# ah-ixq7 — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-09
- **PR:** #1463

## A comment saying the ledger never caps a claim produced an uncapped fix

**What happened.** My first fix priced CLAIM a second time in the preview's walk, calling
`silver::price_claim(amount, None)`, and justified it in a comment that said the ledger prices
claims "uncapped by the faction purse". The cold review showed that the ledger does cap: it prices
each claim against `claim_allowances_for`, which uses up the report's unclaimed silver. With a purse
smaller than the claim, the preview and the SILVER column disagreed again, which is exactly what the
bead set out to remove.

**Why.** The comment on the ledger's `Intent::Claim` arm in `semantics.rs` said "the ledger does not
cap a claim at the faction purse". That stopped being true when `claim_allowances_for` was added
(ah-ykiv), and I took the comment's word for it instead of following `claim_remaining` to where it
is set. A second smell had the same cause: `tests/gifts_across_both_surfaces.rs` pinned the
preview's wrong 100 as a "documented difference", so the defect was guarded by a test.

**Cost.** One extra review round and one extra fix commit, about fifteen minutes. No extra CI cycle.

**Prevent by.** When a fix makes a second surface compute a figure that another surface already
settles (here the preview pricing a claim the ledger had already priced), read the figure off that
settlement rather than recomputing it. The ledger's own `silver_moves` was there all along. In
`skills/fix-bug` *The bug-fix contract*, step 4 could say that a fix copying another surface's
arithmetic should take that surface's answer instead.

**Seen before.** `ah-12h7` (comments the change had made false); this one was a comment an earlier
change had made false.
