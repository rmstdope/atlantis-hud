# ah-wyxx.1 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-08
- **PR:** #1061

## The plan asserted a live defect, with a reachable shape, that was not reachable

**What happened.** The plan's *The two live defects this bead fixes* §1 said a nested `FORM` can
inherit the wrong hex's parent, gave the orders document that triggers it (`FORM 1 / FORM 2 / END /
END` in two hexes), and specified the increment-3 test to pin it. Written as directed
(`cargo test -p atlantis-hud-core --lib a_nested_form_takes`), it passed against the unchanged code.
The reason is two files away from the map the plan was looking at: `FormReader::parent_id`
(`crates/core/src/orders/intents.rs:418`) resolves a nested block's parent to the *innermost
enclosing* block, and `formed_units` mints in document order, so a parent is always minted one step
before the child that asks for it and `minted` is never stale across hexes. Defect 2, in the same
plan, was live and its test was genuinely RED — so the plan was not wrong in general, only about
this one claim.

**Why.** The plan reasoned about the map's key type (`BTreeMap<String, ReportUnit>`, report-wide,
therefore ambiguous) and not about the order its entries are written and read in. That is a sound
way to find a map that *should* be re-keyed, and a bad way to assert that a defect is reachable
today: the key type says what could go wrong, and only the call order says what does.

**Cost.** About twenty minutes — enumerating adversarial orders documents (an unreadable outer
block, a colliding alias, three levels of nesting, a parent unit absent from the report) to be sure
the shape was unreachable rather than merely awkward — plus one blocking review finding, which the
reviewer raised independently on the same reading. No CI cycle: the PR body already carried the
deviation before the review ran.

**Prevent by.** A plan that names a **live** defect should say what makes it *observable*, not only
what makes it *possible* — the call order, or the fixture that reaches it — and `plan-bead` could
ask for that where a plan claims a defect is reachable today. Failing that, this is already
covered from the implementer's side: `implement-bead`'s *When the plan is wrong* says a
current-source claim is checked before its increment begins, and running the specified test first
is what checked it here. The bead was still worth building: the map is report-wide, and its
correctness resting on an incidental ordering property is one edit away from being wrong — which is
what the bead is about. It was shipped as a regression pin with a comment saying so, not as a fix.

**Seen before.** `ah-lyg6.2.3-reopened.md` — *I argued a defect away twice, from evidence that did
not support it* — is the same seam approached from the opposite side, and is why the conclusion here
rests on a test run before the change rather than on reading alone. `ah-lyg6.4.2.md` — *a plan that
names an existing helper as "the shape to copy" inherits its latent bugs* — is the neighbouring case
of a plan's claim about existing code not holding.
