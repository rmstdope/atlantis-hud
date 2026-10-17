# ah-1jl9 — retrospective

- **Implementer:** Gambit
- **Date:** 2026-10-17
- **PR:** #1682

## A sibling bug bead changed the same judgement and merged mid-review, undoing half the fix

**What happened.** ah-1jl9 settles who owns a Caravanserai when the shipments run, inside
`transport::Shipping::read`. ah-kjjv (PR #1673), claimed by another implementer the same day and
linked to this bead as related, changed the same `Shipping` judgement: it added
`Shipping::read_orders`, which calls any target whose structure's occupants LEAVE, ENTER or MOVE
"unsettled" and keeps it from being warned about. #1673 merged while #1682 was in its second review
round. After a rebase, the bead's own acceptance ("warnings on the TRANSPORT and DISTRIBUTE lines")
was silenced by that rule in exactly the bead's cases, and the two PRs conflicted in effects.rs and
semantics.rs.

**Why.** Two bug beads about one shipment check, built in parallel, each correct on its own base.
The `related` edge between them carried no instruction, so neither implementer was told to build on
the other.

**Cost.** One rebase with a hand reconciliation of `read_orders`, three of ah-kjjv's tests rewritten
to the settled answers, one extra question to the navigator, and a third full review round —
about an hour.

**Prevent by.** When `scripts/bugfix-candidates` (or whoever ranks the bugfix queue) hands out a bug
bead with a `related` edge to an `in_progress` bead, the hand-off should say so. The bugfixer then
either waits for that PR or starts from its branch and says which in the PR body. Today the edge
appears only in `bd show`, and `fix-bug` never asks the implementer to look at it.

**Seen before.** ah-z73s.3 (a clean git auto-merge of two compatible-looking changes that did not
compile) is the same family — parallel changes to one place — but a different failure.

## The engine was quoted to the navigator for a case it does not say

**What happened.** The wording question put to the navigator said the engine blames the sender for
both a DISTRIBUTE and a long TRANSPORT from a quartermaster owning no Caravanserai. For the TRANSPORT
it does not: `CheckTransportOrders` caps that sender at `LOCAL_TRANSPORT` and says "Recipient ... is
too far away." The full review caught it, and the navigator had to be asked again.

**Why.** The quote was read off the DISTRIBUTE branch of `CheckTransportOrders` and generalised to
TRANSPORT without reading the TRANSPORT branch above it.

**Cost.** One more round trip to the navigator.

**Prevent by.** `fix-bug` step 1, or the `atlantis-rules` skill: an engine message quoted to the
navigator names the file and line it was read at, one quote per order kind, so a reviewer can check
each one rather than one standing for several.

**Seen before.** none found
