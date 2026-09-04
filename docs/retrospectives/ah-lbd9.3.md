# ah-lbd9.3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-04
- **PR:** #952

## The review sub-agent's smoke run silently tested `main`'s bundle, not the branch's

**What happened.** The cold-read reviewer ran
`pnpm run test:smoke -- --project=desktop-shell newage-fetch` in this bead's worktree and all three
tests failed at `page.getByTestId("newage-fetch-report")`, with a page snapshot showing the *old*
popover — summary, "Nothing is stored…", Sign out, and no fetch button. Nothing was wrong with the
branch: `playwright.config.ts` sets `reuseExistingServer: !process.env.CI`, and a `vite preview`
from the **main checkout** (`apps/desktop`, pid 17224) was already holding port 4174, so Playwright
reused it and the walk ran against `main`. Re-running with `SMOKE_PORT_BASE` set gave 3 passed in
7.3s. My own run of the same spec, from the same worktree minutes earlier, was green — because
`implement-bead`'s *Workspace* section had me export `SMOKE_PORT_BASE` and `CI=1` before I started.

**Why.** Established. `implement-bead` tells the *implementer* to claim a port block and set
`CI=1`; nothing tells the **review sub-agent** to, and the reviewer's checklist asks it to verify by
running the suites. It therefore runs them in a shell that has neither variable, in a worktree
beside a main checkout that usually has a preview server up. The failure is silent by construction:
a stale bundle produces assertion failures that read exactly like a broken branch.

**Cost.** Three false failures and the diagnosis inside a review that took about seventeen minutes;
no CI cycle, because the reviewer worked it out rather than reporting it as a finding. The
expensive version of this is the one where it does not: a review that reports a working branch as
broken sends an implementer to fix nothing.

**Prevent by.** The implementer's review-spawn prompt in `implement-bead`'s *Getting the review*
should hand the sub-agent the port block and `CI=1` it is to use, the same way *Workspace* hands
them to the implementer — the sub-agent inherits neither the shell nor the exports. Alternatively
`agents/reviewer.md` could name the variables where it asks for a suite run. Either is a one-line
change; what does not work is leaving it to the sub-agent to know, because nothing it reads says so.

**Seen before.** `ah-1mpx.3` — same port family, twice in one file: a leftover preview server from
an interrupted run holding the block despite `CI=1`, and the older `--strictPort` trap in
`.cerebro/traps.md`. This is the third sighting and the first where the process holding the port
belongs to a *different checkout* and the runner reuses it deliberately rather than colliding with
it — so `CI=1` is the fix here, and it is exactly the variable the sub-agent was never told to set.
