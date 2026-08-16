# ah-eet — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-17
- **PR:** (opened alongside this commit)

## No browser automation tool was available for the plan's manual look-once step

**What happened.** The plan's *Validation* section specified a manual browser check: run
`pnpm --filter @atlantis/web dev`, load a real report fixture in the app, add one order, and
confirm the exact warning sentence appears (then remove it and confirm it disappears). The dev
server started fine, but no `claude-in-chrome`-style browser-automation tool was reachable in this
session — `ToolSearch` for it turned up nothing usable, only unrelated tools (WebFetch, a Pencil
design-canvas screenshot tool). The Skills listing does mention `claude-in-chrome`, but invoking it
requires an extension connection that this session did not have.

**Why.** Not established with certainty — possibly the extension was never connected for this
implementer's environment, possibly it needs a one-time interactive grant this headless session
could not give. Either way, the gap was in what was reachable at runtime, not in the plan.

**Cost.** About 10 minutes: starting and then tearing down the dev server, and one `ToolSearch`
round trip confirming no browser tool was available, before falling back to relying on the unit
test suite's fixture-verified arithmetic (the test plan's fixture weights were independently
cross-checked against the real `neworigins-3.0.0-g5-f21-t24.rep` file's `Load: 220/450` line and
matching unit weights, which line up with the plan's citations) plus the always-green
`the_committed_turn_has_no_semantic_problems_either` whole-turn integration test as the closest
substitute for an in-app look.

**Prevent by.** Before an implementer plans to rely on `claude-in-chrome` for a manual look-once
step, confirm in the `implement-bead` skill (or the planning session) that the tool is actually
reachable from a headless implementer session, not just listed as a skill. If it usually is not,
the plan's validation step should default to the equivalent fixture-based Rust check (as done
here) rather than assuming an interactive browser is available, and the skill could name that as
the accepted substitute so a future implementer does not have to work it out from scratch.

**Seen before.** None found.
