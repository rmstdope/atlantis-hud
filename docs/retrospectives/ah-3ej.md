# ah-3ej — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-17
- **PR:** #408

## The plan's call site served five orders, and the plan spoke about one

**What happened.** The plan quoted the exact replacement for the `Arg::Skill` arm of
`completions_for` (`crates/core/src/orders/completion.rs`) and I wrote it verbatim, as planned. That
arm is reached by every order with an `Arg::Skill` position — `CAST`, `COMBAT`, `FORGET` and
`SHOW SKILL` as well as `STUDY` — so the study-only filters (drop the unpriced, drop the maxed)
silently narrowed the other four. `FORGET` stopped offering the maxed skill that is the whole reason
to type `FORGET`. Every one of my eight planned tests passed: they all asserted about `STUDY `. The
Copilot review caught it, and the fix gates on `order.name` the way `item_completions` already does.

**Why.** The plan's *Files to change* section names the call site and its new body, and its *Out of
scope* names `GIVE` as a sibling bead — so it reads as having considered who else is affected. What
it does not say is that the arm it is editing is shared, and the test plan is eight `STUDY` tests
with no row for "the other orders are unchanged". Nothing in the plan is wrong; it is silent, and I
built the silence.

**Cost.** One extra commit, one review round-trip and a full CI cycle — about 25 minutes. No bead
handed back; the fix was a detail, and `item_completions` was already the precedent for it.

**Prevent by.** When a plan hands you a diff for a `match` arm or any other shared branch point,
check who else reaches it *before* writing the arm — `grep` the variant (`grep -n "Arg::Skill"
crates/core/src/orders/grammar.rs` was the whole check, ten seconds) — and add a test that the other
callers are unchanged. A plan quoting a body is not a claim that the body has one caller.

**Seen before.** `ah-u4e.3` — "the plan named `mergeTurn`'s consumers, but missed one of the two call
sites". Same shape: the plan enumerated the blast radius and the enumeration was short.
