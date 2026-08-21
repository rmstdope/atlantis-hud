# ah-qled.8 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-21
- **PR:** #537 (and rmstdope/cerebro#80)

## An acceptance criterion demanded a grep that no work in this bead could make pass

**What happened.** The bead's acceptance criteria required, verbatim:

```
grep -rnE "pnpm|tauri|vite|@atlantis|5173|4174|4183" agents/ skills/ docs/   # returns nothing
```

Run on `origin/main` before any change, that matches **26 lines across nine files**. Only six of
them are about launching the application. The rest are `pnpm sightings` in `orchestrator.md`,
`pnpm install` as an example of *running a stranger's code* in `reviewer.md`, `pnpm-workspace.yaml`
named as a workspace manifest in `architect.md`, and `pnpm exec tsx scripts/diskPreflight.ts` in
`implement-bead` — none of which this bead touches, and several of which belong to **ah-qled.10**
("The prose stops naming this project and its players"), still open.

The plan's own *Increments* section contradicted the criterion, naming exactly four GREEN files:
`verifier.md`, `reviewer.md`, `implement-bead/SKILL.md`, `docs/agent-workflow.md`.

**Why.** The criterion was written as though this bead were the last one in the epic. It was
authored while sibling beads covering the same tokens were still open, and nobody re-ran the grep
against `main` to see what it actually matched.

**Cost.** About ten minutes deciding whether the mismatch was a scope question to hand back or a
detail to settle. I settled it — the increments name the files, so the increments win — and
narrowed the test's grep to the four launch sites and to launch-shaped tokens
(`pnpm --filter`, `tauri`, `@atlantis`, the port numbers). No CI cycle, no hand-back.

**Prevent by.** `plan-bead`'s acceptance-criteria step should **run any grep it writes as a
criterion, against `origin/main`, and paste the count**. A criterion phrased as a command is a
promise that the command is the test; one that cannot pass on the day it is written is a trap for
the implementer rather than a check. Where the grep is genuinely epic-wide, the criterion should
say so and name the sibling bead that finishes it.

**Seen before.** ah-qled.1 — *"The plan's acceptance criteria contradicted a smoke test the plan
never mentioned"*, the same epic, the same shape: an acceptance criterion that no work in that bead
could satisfy.
