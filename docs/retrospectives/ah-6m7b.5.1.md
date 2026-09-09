# ah-6m7b.5.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-09
- **PR:** #1120

## The plan forbade the one change its own promise required

**What happened.** The plan's *Files to change* said, in bold, **"Do not touch `items_moved` or the
row-inclusion gate"**, and in the same paragraph promised that "a unit whose only month event is a
gift of silver keeps its preview row, exactly as today". Those cannot both hold. That row survived
the gate at `crates/core/src/orders/effects.rs:845-863` *because of* the `items` `FieldChange` the
bead's increment 8 makes silver-blind; removing it dropped the row, and five existing tests went red
on `cargo test -p atlantis-hud-core --lib orders::effects` with messages about units that were "not
previewed" rather than about items.

Setting `items_moved` in the paths that move stock outside the ledger is what the gate's own comment
says the flag is for, so the deviation was clear. What was not clear was **how many such paths there
are.** Two are obvious from the plan's own *Where* list (`move_between`, `GiftReverted`); the third,
`take`'s unshown-source branch at `:2386-2408`, is named nowhere in the plan and bypasses
`move_between` entirely. It shipped into the first PR head. The fast gate did not catch it — no
existing test takes silver from an unshown unit — and it took the review sub-agent's cold read,
which found it by mutation.

**Why.** The plan treated a *forbidden file* as the unit of scope where the real unit was a
*behavioural invariant* ("every previewed row survives"). Having been told not to touch the flag, I
enumerated the sites the plan happened to name rather than asking `grep -n items_moved` and
`grep -n item_changes.push` what the complete set was.

**Cost.** About 25 minutes: five red tests to diagnose, and one extra review round and CI cycle for
the missed third path.

**Prevent by.** When a plan removes something the row-inclusion gate at `effects.rs:845-863`
depends on, its *Validation* section should require enumerating every writer of the replacement
signal — `git grep -n 'items_moved\|item_changes.push' crates/core/src/orders/effects.rs` — rather
than listing the sites it happens to have noticed. More generally: a plan that forbids touching a
mechanism *and* promises behaviour that mechanism carries has an unstated contradiction, and finding
one is a reason to enumerate rather than to follow the list given.

**Seen before.** `ah-rgkk.3.1` — the same gate and the same flag, from the other direction: that
bead widened the gate and admitted rows for orders with no effect. Two beads have now paid for the
gap between "what `changes()` records" and "which rows exist"; a third sighting would be a case for
making that relationship explicit in the code rather than in a comment.
