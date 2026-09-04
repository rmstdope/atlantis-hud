# ah-lyg6.1.2.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-04
- **PR:** #937

## `tsc -b packages/shared` emitted the whole package into `src/`, and I committed it

**What happened.** To typecheck one increment I ran `pnpm exec tsc -b packages/shared`. That project
has no `noEmit` in its build configuration, so it wrote a `.js` and a `.d.ts` beside every source
and test file — 726 new files — and the increment's `git add -A` swept them all into the commit. The
commit looked normal (the message and the four real files were right); only `git show --stat` made
it visible. Unwinding it meant `git reset HEAD~1`, deleting every untracked file except the four the
bead had actually added, and committing again. It also inflated the local test count from 2919 to
5804, because vitest then collected the emitted `.test.js` copies as well.

**Why.** `packages/shared/tsconfig.json` is a real build configuration, not a checking one; the
project's own script is `tsc --noEmit -p tsconfig.json`, run as `pnpm --filter @atlantis/shared run
typecheck`. `tsc -b` on the same path does what it says.

**Cost.** About ten minutes, and one commit that had to be reset and rebuilt.

**Prevent by.** Typecheck one package with the project's own script —
`pnpm --filter <package> run typecheck` — and never `tsc -b` or a bare `tsc -p` against a package's
`tsconfig.json`. `implement-bead`'s *Building* section already says to run what
`project-conf gate_fast` names; the same applies to a single leg of it during an increment, which is
where I reached for the compiler directly instead.

**Seen before.** None found — `grep -rl "tsc -b" docs/retrospectives/` matched nothing.
