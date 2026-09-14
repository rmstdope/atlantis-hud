# ah-t8c4 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-14
- **PR:** #1262

## `npx prettier --write` reformatted the tree again, for the fourth time

**What happened.** Increment 3 changed ten TypeScript files by script. To tidy them I ran
`npx prettier --write packages/core-client/src packages/browser-core/src packages/shared/src/workspace/AppShell.tsx tests/native/sweep.ts scripts/tauriCommands.test.ts`.
The repository has no prettier (`ls .prettierrc*` finds nothing and `package.json` does not name it),
so npx applied its own defaults. It rewrote about a hundred files, generated ts-rs bindings included,
and turned my own ten files into file-wide reformats: `git diff --stat` showed 3,278 insertions and
1,818 deletions for about 250 lines of real change. `pnpm run check:fast` flagged nothing about the
formatting; the only thing it caught was one unused import. I reverted everything with
`git checkout`, then re-applied the edits from scratch.
**Why.** npx fetches and runs a formatter the project does not use, with its defaults, over
everything it is pointed at. The prevention the earlier retrospectives proposed lives only in those
retrospectives, which an implementer has no reason to open before reaching for a formatter.
**Cost.** About fifteen minutes: the revert, re-running every TypeScript edit, and a second fast-gate
run. It did not reach a reviewer only because I read `git status` before committing.
**Prevent by.** The line ah-g9sf.7.1 proposed for `.cerebro/traps.md`: this repository declares no
formatter, `npx prettier` rewrites whole files, and `awk 'length > 100'` over the touched files is the
real check. This is now its fourth sighting. A `check:fast` leg that fails on a formatting-only diff
would be the stronger fix.
**Seen before.** ah-lbd9.4, ah-dbw4, ah-g9sf.7.1 — the same command, the same absent config.
