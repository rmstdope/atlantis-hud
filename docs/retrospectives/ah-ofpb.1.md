# ah-ofpb.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-26
- **PR:** #705

## A rebase past a new workspace package left the gate failing on a missing module, not a real regression

**What happened.** `prepare-worktree` ran `pnpm install` when the worktree was created. Between
then and the PR opening, main gained a new workspace package (`packages/ruleset`, from
`ah-97ij.1`, an unrelated bead). After `git rebase origin/main` picked up that commit,
`pnpm run check:fast` failed with `Cannot find module '@atlantis/ruleset'` in
`scripts/atlantis.test.ts` and `scripts/atlantis.ts` — both typecheck and test legs failed, in
files this bead never touched, which read exactly like a regression the change had caused.
**Why.** `pnpm install` links workspace packages into `node_modules` at the time it runs. A new
workspace package added to main after that point is invisible to an already-prepared worktree
until `pnpm install` runs again — a plain rebase brings in the new `package.json` and source but
does not re-link it.
**Cost.** About five minutes: reading the failure, ruling out my own change as the cause (the
failing files were untouched by this bead's diff), and running `pnpm install` to confirm it fixed
both legs.
**Prevent by.** After any rebase or `update-branch` that pulls in commits from main, re-run
`pnpm install` before trusting a gate failure to be about the bead's own diff — cheap, and it
rules out this class of false failure before time goes into debugging code that is not broken.
Worth a line in `implement-bead`'s *Merging* section if it recurs.
**Seen before.** None found.
