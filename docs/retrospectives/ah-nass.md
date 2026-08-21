# ah-nass — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-22
- **PR:** #539

## The plan asked for a change to a file that lives in a different repository

**What happened.** The plan's fourth increment asked for "a line in `plan-bead`" alongside the code
change. `.claude/skills/plan-bead` is a symlink into the `.claude/cerebro` submodule, so the edit
landed in a separate repository (`rmstdope/cerebro`) and `git add -A` produced only a dirty
submodule pointer. `git check-ignore` on the path answers
`fatal: pathspec '...' is beyond a symbolic link`, which is the first sign anything is unusual.
The bead therefore needed **two PRs** — #539 here and rmstdope/cerebro#83 — and its own increment
could not ship in its own PR.

**Why.** Established. The skills directory is symlinked into the submodule (`ah-gdp`'s
retrospective names the same symlink for a different reason), and a submodule is a different
repository with its own review and merge.

**Cost.** About fifteen minutes: one commit that silently omitted the change, then a second branch,
push, PR and review cycle in the other repository. Nothing was lost.

**Prevent by.** `plan-bead`'s *Everything you cite must exist* section should add that a path under
`.claude/skills/` is a symlink into the `cerebro` submodule, so a plan asking for a change there is
asking for a second PR in a second repository — and should say so, in the increment, so the
implementer budgets for it rather than discovering it at `git status`.

**Also worth deciding, and not mine:** the submodule pointer in this repository is not bumped by
this PR, because `origin/main` of `cerebro` is now three commits ahead — `ah-qled.7.2` and
`ah-qled.11` as well as mine — and sweeping two other beads' fleet changes in was not this bead's
call. The cerebro-side line is therefore merged but inert until somebody bumps the pointer.

**Seen before.** `ah-gdp.md` names the same symlink, as a submodule-init failure rather than as a
cross-repository change. None found for the two-PR consequence.

## A grep for a symbol found nothing, and I believed it

**What happened.** The plan cited `useReportedRect` and `MeasuredFactionDossier` as the worked
example. `grep -rn "useReportedRect\|MeasuredFactionDossier" packages/shared/src -l` returned
nothing, so I recorded in the PR body that neither exists and wrote the guidance around
`FactionDossierPanel.tsx` instead. **Both exist** — they are exported from that very file, below
the component. Copilot caught it, correctly, and pointed out that the component is deliberately
hook-free and that the rule is actually called from `MapCanvas.tsx`. The wording being wrong
mattered more here than usual: the whole deliverable of this bead is a paragraph that a confused
person is shown, and it was pointing them at a call that is not there.

**Why.** The grep was run with a trailing `--include=*` that zsh expanded against the working
directory, so the pattern was consumed as a path argument and the search never ran over the tree it
looked like it was searching. It printed a plausible-looking list of unrelated files rather than an
error, which is what made it believable.

**Cost.** One review round and one extra commit, about ten minutes — and it would have shipped
wrong guidance if the review had not landed.

**Prevent by.** Treat an empty grep as a result to confirm, not a fact, when a plan says the symbol
is there: the plan is more likely right than the shell. Concretely, `grep -rn "<symbol>" <dir>`
with no flags, and read the exit status — a zsh glob failure prints `no matches found` on stderr
and is easy to scroll past when the command is chained behind `&&`.

**Seen before.** None found.
