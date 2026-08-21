# ah-qled.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-21
- **PR:** #515 (and rmstdope/cerebro#67)

## A file the plan said must be tracked was silently git-ignored

**What happened.** The bead's central decision is that `.claude/cerebro-project.conf` is **tracked**,
not ignored like `.cerebro/models.conf`. I wrote the file, and `git status` did not mention it —
`.gitignore:32` is `.claude/*` with four negations under it, none of which covered the new name. Only
running `git check-ignore -v .claude/cerebro-project.conf` on purpose, because the acceptance
criteria named tracking explicitly, revealed it. Committing at that moment would have produced a PR
that looked complete, passed every check, merged, and delivered **exactly the failure the bead exists
to prevent**: a file that vanishes on a fresh clone.

**Why.** A directory-wide ignore with an allow-list is invisible from the side of the file being
added. `git status` says nothing, `git add <path>` without `-f` says nothing in a `git add -A`, and
no gate in this repository looks at whether a new file reached the index.

**Cost.** About five minutes, because the bead happened to state "tracked" as an acceptance
criterion so I checked. With that criterion phrased any less explicitly it would have cost a merged
PR and a later confusing failure on somebody's fresh clone.

**Prevent by.** When a plan says a new file must be **tracked**, run `git check-ignore -v <path>`
before committing, and after `git add` confirm the path appears in `git status --short` with an `A`.
Worth a line in `implement-bead`'s *Building* section: any bead whose acceptance criteria contain the
word "tracked" gets that one command, since the gate cannot see it and `git status` actively hides it.

**Seen before.** None found — no retrospective in this directory mentions `check-ignore` or
`.claude/*`.

## Copilot's review came back as an error, for the fifth recorded time

**What happened.** The review requested on cerebro#67 arrived as a `COMMENTED` review whose entire
body was *"Copilot encountered an error and was unable to review this pull request. You can try again
by re-requesting a review."* — no inline comments. The wait loop in `implement-bead` counts any
Copilot review as the review, so it ended the wait satisfied; but the rule that the one request is
spent and must never be re-issued left no path forward that did not either merge unreviewed or
escalate a bead six children depend on. I put the question to the navigator, who arranged a
re-request; the real review landed six minutes later, reviewed both files, and generated no comments.

**Why.** Two rules that are each correct in isolation meet badly here. *One review per PR, never
re-requested* assumes a review that happened. *Wait until a Copilot review exists* counts an error
report as one. Neither anticipates a review that is delivered and empty.

**Cost.** About fifteen minutes and one navigator interruption at a point where nothing needed
deciding by a human.

**Prevent by.** `implement-bead`'s *The review* section — treat a Copilot review whose body matches
`encountered an error` as **no review at all**: do not end the wait on it, and allow exactly one
re-request against it without it counting as a second review. Four earlier retrospectives already
propose this in nearly identical words; this is the fifth sighting and the first where it cost the
navigator's attention rather than only the implementer's time.

**Seen before.** ah-60m, ah-hiib.2, ah-lcyn, ah-yk6b.
