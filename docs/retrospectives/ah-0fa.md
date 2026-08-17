# ah-0fa — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #411

## A fresh worktree still has no wasm build — third sighting

**What happened.** The first `pnpm run test:smoke` in the new worktree — the RED run of this bead's
only test — never started: the web server died with
`Could not resolve "./wasm/atlantis_core.js" from packages/browser-core/src/coreWasm.ts`, which
reads as a code fault in the branch rather than a missing generated artefact.
`pnpm --filter @atlantis/browser-core run build:wasm` (19s) fixed it.
**Why.** Established and unchanged since ah-o1t.3: `packages/browser-core/src/wasm/` is generated
and git-ignored, so neither `git worktree add` nor `pnpm install --frozen-lockfile` produces it, and
`implement-bead`'s *Workspace* block does not mention it. `check:fast` does not need it (a
`pretypecheck` hook covers typecheck), so the gap only shows for a bead whose proof is a browser
walk — which is exactly a bead like this one, where the smoke test *is* the RED.
**Cost.** One failed smoke start and the 19s build, a few minutes. As with the two before it, the
recurrence is the finding, not the size.
**Prevent by.** What ah-o1t.3 and ah-ziv both already asked for: `build:wasm` in whatever prepares a
worktree — `implement-bead`'s *Workspace* block alongside `pnpm install --frozen-lockfile`, or the
`prepare-worktree` script the cerebro submodule now carries. Three implementers have now paid for it
from memory instead.
**Seen before.** ah-o1t.3 and ah-ziv — same error, same cause, same fix.
