# ah-dksm — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-09
- **PRs:** rmstdope/cerebro#349, #1085

## Editing a bash script while a run of it was still executing invalidated an 18-minute validation

**What happened.** I started the bead's end-to-end validation —
`.claude/cerebro/scripts/smoke-port -- pnpm run test:smoke` — in the background, then spent the next
twenty minutes answering review findings by rewriting `scripts/smoke-port` in place. The running
process was still reading that file. When I looked at the reservations it held, there were **two
locks with the same pid**, seventeen minutes apart, and a `vite preview` on a port the script's own
stderr had never announced. I spent about ten minutes treating that as a defect in the reservation
logic before recognising the cause.

**Why.** Bash reads a script incrementally, by byte offset, as it executes. Rewriting the file under
a running interpreter shifts every offset after the edit, so the process resumes somewhere else in
the new text — here, re-entering the block-selection loop it had already left. Nothing in the output
says this has happened; it looks exactly like the program misbehaving.

**Cost.** About 30 minutes: ten chasing a phantom defect, and an 18-minute validation run that had
to be thrown away and repeated.

**Prevent by.** `implement-bead`'s *Waiting, without ending your run* is where a long external wait
is described, and it says nothing about what may be changed while one is in flight. A sentence
belongs there: while a background run of a file in your own diff is executing, that file is
read-only — answer findings in other files, or wait for the run. This applies to any interpreted
file a running command reads, not only to bash.

**Seen before.** None found — `grep -rl "while it was executing\|running bash script" docs/retrospectives/`
returns nothing.

## 25 minutes chasing a smoke failure that had already been fixed on main

**What happened.** The validation run above failed one spec —
`tests/smoke/study-planner.spec.ts:315`, "a note is kept without pressing anything". It reproduced
in isolation, so not a flake. My diff touches no application or spec file, which I argued made it
main's failure rather than mine; I then checked main's CI, found it green, and only at that point
noticed my worktree had been branched **five commits behind** `origin/main`. After
`git rebase origin/main`, the same spec passed.

**Why.** `prepare-worktree` branches from `origin/main` as it stood when the worktree was made, and
this bead ran for several hours across two repositories. A defect present at my base commit was
fixed upstream while I worked.

**Cost.** About 25 minutes, including one full single-spec run at each of the two bases.

**Prevent by.** When a browser suite fails on a change that touches no application code, update the
branch *before* diagnosing: `git fetch origin main && git rebase origin/main`, then re-run the one
spec. It is one cheap command against an expensive investigation. `implement-bead`'s *Red CI*
already says to read a failure before believing it; the missing half is that a stale base is one of
the things "read it" should mean, and it is testable in a way that guessing is not.

**Seen before.** `docs/retrospectives/ah-l9mp.md` — "Three CI cycles chasing a failure that a branch
update made vanish", whose own *Prevent by* asks for exactly this line and notes it "is the cheapest
way to rule out a stale base". This is its second sighting, and the first was about CI where this
one is about a local suite.
