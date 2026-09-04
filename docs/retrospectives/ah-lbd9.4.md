# ah-lbd9.4 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-04
- **PR:** #956

## The port block I checked at the start of the session was taken by the time I ran smoke

**What happened.** `implement-bead`'s *Workspace* section had me pick a port block and check it with
`lsof` before starting. I did: `4183` read free at 23:09. Forty minutes later, at the end of
increment 6, `SMOKE_PORT_BASE=4183 pnpm run test:smoke` failed before running a single test with
`Error: http://127.0.0.1:4183 is already used, make sure that nothing is running on the port/url`.
Moving to `4203` — re-checked at that moment — ran 4 passed in 9.1s.
**Why.** Another worktree took the block in the interval. Nothing reserves one: the `lsof` check *is*
the whole mechanism, so it is only true for as long as it takes to be overtaken, and a bead spends
most of an hour between the check and the run that needs it.
**Cost.** Small — one failed invocation and a re-check, about two minutes. It is recorded because the
failure mode is silent about its real cause: the message names the port, not the fact that the
check I was told to run had gone stale.
**Prevent by.** `implement-bead`'s *Workspace* section asks for the `lsof` check once, "before
claiming one". It should ask for it again immediately before each smoke run, which is
`docs/retrospectives/ah-1mpx.3.md`'s *Prevent by* verbatim — that recommendation has now been
arrived at twice, from two different failures, and is still not in the skill.
**Seen before.** `ah-1mpx.3` (a leftover preview server holding the port after an interrupted run,
which cost twenty minutes) and `ah-lbd9.3` (a reused server making a walk run against `main`). Three
sightings of the same underlying fact: the port block is unreserved and unchecked at the moment it
matters.

## `npx prettier --write` reformatted a file in a repository that has no prettier

**What happened.** After hand-editing `NewAgeSignInFields.tsx` with a script, I ran
`npx prettier --write` on it to tidy the indentation. `npx` fetched prettier — the repository has no
`.prettierrc`, no `prettier` dependency and no format script — and reformatted the whole file to
prettier's defaults, adding trailing commas and re-wrapping untouched lines. The diff went from the
three hunks I meant to a file-wide reformat. `git checkout` and a hand-edit put it right.
**Why.** `npx` silently installs and runs a tool that is not part of the project, and with no config
present it applies its own defaults to the entire file rather than the region I changed.
**Cost.** About five minutes, and it would have cost a reviewer far more had I not noticed: a
file-wide reformat buries a three-line change.
**Prevent by.** Check the project actually declares a formatter before invoking one — this repo's
gate is `pnpm run check:fast` (lint, typecheck, tests, fmt, clippy) and its `lint` leg is the only
authority on TypeScript style. Never reach for `npx <formatter>` on a file in a repository where
`grep -l prettier package.json` finds nothing.
**Seen before.** None found.
