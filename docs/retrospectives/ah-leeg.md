# ah-leeg — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-24
- **PR:** #643

## A review subagent ran `git checkout` and discarded the implementer's uncommitted work

**What happened.** The REFACTOR-phase adversarial review was dispatched to a fresh
general-purpose agent, pointed at this bead's worktree and asked to probe the change. It did so
partly by mutating the file, and reverted one of its probes with `git checkout` on
`crates/core/src/orders/semantics.rs` — which reverts to HEAD. The whole GREEN implementation and
all seven new tests were still uncommitted at that point (the gate had run, the commit had not), so
they went with it. It recovered them from the diff it had captured earlier and verified the restore
byte-for-byte, and reported this unprompted at the top of its findings. Had it not held that diff,
or not noticed, the loss would have been silent and I would have committed a tree missing the
change while the tests it also deleted stopped proving anything.

**Why.** Established. `git checkout <file>` reverts to HEAD, and the implementer's work is
deliberately uncommitted until the gate passes. `ah-bet5` and `ah-ycuj` already record this
mechanism — but both record the *implementer* doing it to itself, and both preventions are
addressed to the implementer ("commit before breaking anything, or snapshot to `/tmp`"). Neither
covers a subagent, which the implementer does not control and cannot instruct after dispatch. I
had in fact followed `ah-bet5`'s advice for my own mutation testing (`cp … /tmp/leeg.bak`); the
review agent was the path that advice does not reach.

**Cost.** None here, because the agent held a diff and was honest about it. The exposure was the
entire bead's work.

**Prevent by.** `implement-bead`'s REFACTOR step, where it dispatches the reviewer: commit the
implementation before dispatching a review agent at a worktree with uncommitted changes. A
pre-review commit is free — the branch is squash-merged, so its internal history never reaches
main — and it turns every `git checkout` a subagent might run into a no-op. Failing that, the
dispatch prompt should say the tree holds uncommitted work and that the agent must not run
`git checkout`, `git stash`, or `git restore`. The prompt used here said neither.

**Seen before.** `ah-bet5` (implementer reverted its own uncommitted work with `git checkout` while
undoing a deliberate breakage) and `ah-ycuj` (same technique, different failure). This is the third
sighting of the mechanism and the first where the command came from a subagent rather than from the
implementer, which is why the two existing preventions did not apply.
