# ah-66yi — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-02
- **PR:** #880

## Three beads changed one `GIVE` model at once, and this one paid two merges for it

**What happened.** `crates/core/src/orders/targets.rs` and the three surfaces that read it are the
whole of what this bead rewrites. While its PR was open, **two sibling beads landed on main touching
exactly those files**: `ah-t8ei` (#877, mages keep their men through a GIVE) added
`targets::mage_give_refused` and wired it into all three surfaces, and `ah-dhga` (#878, dissolve
unrecruited formed units) changed `formed_units` and the `hex_with_transfers` call this bead had
already re-signed. `gh pr view --json mergeStateStatus` read `CONFLICTING DIRTY` twice, once after
the review was answered and once **after the final review round had already approved the head**.
Each merge cost a conflict resolution, a re-gate and a fresh CI cycle, and the first one was a real
semantic decision rather than a textual one: `ah-t8ei`'s mage refusal and this bead's new
`GiveOutcome::Uncertain` both sit in front of the same three code paths, and getting their order
wrong would have made a mage's gift of men to an unseen unit read as "cannot be told" instead of
"refused".

**Why.** Not a plan defect, and not an implementation one: three beads were planned and ranked
independently, and nothing in the queue said they share a model. `bd ready` orders by priority and
readiness, and the dependency graph expresses *blocking*, not *touches the same file*. Two of the
three were even about the same rules page.

**Cost.** About 35 minutes — two conflict resolutions, two re-gates, two CI cycles — plus one review
round spent on the merge itself, and the last of those landed after the change had already been
signed off, which is the part that stings.

**Prevent by.** When a planner writes a plan whose *Files to change* names a shared decision point —
`orders/targets.rs` here, and anything else several surfaces call to agree with each other — checking
`bd list --status=open --label planned` for another bead naming the same file, and adding a `bd dep`
between them. Sequencing them costs one bead's wait; overlapping them cost this one two merges and
would have cost a wrong answer if the precedence had been resolved the other way. The precedence is
now pinned by `a_mages_gift_of_men_is_refused_rather_than_left_uncertain`, so the next bead in this
area at least fails loudly rather than silently.

**Seen before.** `ah-t8ei` — the other half of this collision, from the other side: its retrospective
records an existing test broken by its own prohibition, in the same file, the same day. None found
for the shared-file collision itself.

## A plan-specified closure signature could not compile, and the error named unrelated code

**What happened.** The plan specifies the Silver seam as
`uncertain_after_gifts: &'a dyn Fn(&str) -> Option<&'a str>` on `silver::Lookups<'a>`. Written as
given, it does not build — the borrowed return ties `'a` to each closure's own borrow, so every
existing `Lookups` literal fails with `` `rules` does not live long enough … this usage requires
that `rules` is borrowed for `'static` ``, reported against **`class_carries_silver`**, a field this
bead does not touch, in test code the bead does not touch either. Returning `Option<String>` fixes
it outright.

**Why.** A struct of borrowed closures shares one lifetime parameter across every field, so adding a
field whose *return* borrows `'a` retroactively constrains all of them. The plan named a plausible
signature without building it, and rustc's message points at the first field that fails rather than
at the field that caused it.

**Cost.** About ten minutes, most of it spent reading an error about a field that was not the
problem.

**Prevent by.** A plan that specifies an exact Rust signature on an existing borrowed-closure struct
should return owned data (`String`, not `&'a str`) unless it has a reason not to — the allocation is
one per doubted unit per keystroke, against a lookup that answers `None` for almost every tag. More
generally, a signature in a plan is a suggestion the implementer may have to change, and this one is
recorded as a deviation in the PR body rather than treated as a defect.

**Seen before.** None found — `grep -rl "lifetime" docs/retrospectives/` returns nothing about a
plan-specified signature.
