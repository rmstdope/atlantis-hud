# ah-ohc2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-22
- **PR:** cerebro #84, atlantis-hud (submodule bump)

## The plan's resolution order was wrong, and only the Copilot review caught it

**What happened.** The plan specified `consumer-root` should ask
`git rev-parse --show-superproject-working-tree` **first** and fall back to the existing path
arithmetic. Built and tested exactly that way; all `tests/*.sh` and 267 ERT tests passed. Copilot
then pointed out that the probe answers about whatever repository the checkout belongs to — so for a
plain (non-submodule) *copy* at the standard `.claude/cerebro` mount inside a consumer that is
itself a submodule of something else, it resolves to the **grandparent**, not the consumer. The
arithmetic-first order (which `roster`'s two candidates already used, per the same plan) has no such
hole. Reordered, added a regression test for the nested case, and it went green.

**Why.** Established. The plan reasoned about the probe's *reach* (any mount depth or name) and
about keeping the arithmetic for git-less paths, but not about the probe being *wrong* where both
answer. Neither the plan's test table nor mine had a case where the two disagreed, so the tests
could not have found it: every fixture consumer was a top-level repository.

**Cost.** One review round and one CI cycle, roughly 15 minutes. Nothing shipped wrong.

**Prevent by.** When a plan specifies two resolution strategies in a fallback order, the test plan
should carry one case where **both** strategies answer and they disagree — that is the only case the
order is actually about, and a suite of cases where exactly one answers proves nothing about it.
Worth a line in `plan-bead`'s test-plan guidance rather than in any one bead.

**Seen before.** none found — `docs/retrospectives/ah-30t.md` and `ah-aao.md` mention superprojects,
but both are about uninitialized submodules in fresh worktrees, not about resolution order.
