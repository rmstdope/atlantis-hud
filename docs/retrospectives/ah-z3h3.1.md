# ah-z3h3.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-14
- **PR:** #1252

## The plan's first increment had already shipped on main in another bead

**What happened.** The plan's increment 1 fixed a live Trident defect in three places. `trace_orders_on_map`, `preview_orders_on_map` and `month_end_hexes` read the orders document through the New Origins twin, and `from_document_with_ruleset` walked without its ruleset. I built it test-first, opened the PR, and got it through a review round. The PR then read `CONFLICTING DIRTY`. `git log 66c8a224..origin/main` showed that `a5b8bdb6` (#1249, ah-xmqo) had merged the same fix to the same four lines, with its own Trident pin, while this bead sat planned. The plan's *Known traps* warned about a concurrent branch calling a removed twin, but not about a concurrent bead fixing the defect itself.

**Why.** #1249 was planned and built in parallel with this bead, and nothing linked the two. Neither bead's plan named the other, though both touched `OrderedUnits::from_document_with_ruleset` and the same three call sites.

**Cost.** The first increment's code, a review round and a CI wait were wasted. A rebuild of the branch on main followed, with a second cold-read review. About 45 minutes.

**Prevent by.** In `plan-bead`, before a plan names a defect to fix at specific lines, check that no open or recently merged bead touches those lines, for example with `git log origin/main -S '<the call>'` and a scan of in-progress beads' `design` fields for the same function. If one does, add a dependency edge or name the overlap in *Known traps*. In `implement-bead`, the *current-source claim* check caught this only after the first review: run `git fetch origin main` and re-check the plan's quoted lines before the opening failing test, not just against the worktree created at claim time.

**Seen before.** ah-728m.2.1 (a sibling bead shipped this one's seam while it sat handed back), ah-5jkt.1 (the plan's central premise had been overtaken by a bead that shipped after it).
