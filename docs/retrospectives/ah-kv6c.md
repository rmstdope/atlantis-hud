# ah-kv6c

## `npx prettier --write` reformatted unitTooltip.ts and its test, again reaching the reviewer

**What happened.** After wiring a one-line flag and editing six tests, I ran `npx prettier --write`
on `packages/shared/src/unitTooltip.ts` and `unitTooltip.test.ts` to tidy them. The repository has
no prettier, so npx applied its defaults (trailing commas, 80 columns). A ~15-line change became
+637/−348. The gate passed (lint does not check formatting), and the follow-up review flagged it as
a should-fix.

**Why.** Habit. Nothing on the producer's path says this repository has no formatter. The
`produce-bead` skill, `CLAUDE.md` and `.cerebro/traps.md` are all silent, and the gate stays green
after a reformat, so nothing catches it before review.

**Cost.** One review round: restore both files from the reviewed head, reapply the edits by
script, re-gate, push.

**Prevent by.** An entry in `.cerebro/traps.md` ("this repository has no formatter; never run
`npx prettier`"), or a PreToolUse hook that refuses `npx prettier` in Bash. Seven occurrences say
that knowing this has not been enough.

**Seen before.** `ah-mw1r.3`, `ah-lbd9.4`, `ah-t8c4`, `ah-49is`, `ah-dbw4`, `ah-g9sf.7.1`.
