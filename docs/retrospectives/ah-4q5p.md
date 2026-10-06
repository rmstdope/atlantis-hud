# ah-4q5p retrospective

## Removing an import that looked unused passed locally and broke every CI job

**What happened.** The bead deleted the only use of `ItemKind` in
`crates/core/src/orders/semantics.rs`, and clippy then flagged the import as unused, so I removed it.
`pnpm run check:fast` was green on the branch. Meanwhile main gained a new use of `ItemKind` in the
same file (b984ecae, ah-yw4p, #1408). CI builds the merge ref, so all nine jobs failed with E0433
"cannot find type ItemKind". The cold review caught it from the red run, before I had started
waiting on CI.

**Why.** The fast gate checks the branch as it was cut. A removal (an import, a function, a
variable) is the one kind of change whose correctness depends on what *other* commits use. main
moves several times an hour here, and the branch was one commit behind.

**Cost.** One full CI run (about ten minutes of runner time across nine jobs), a rebase, a second
local gate run and a force-push.

**Prevent by.** In `produce-bead`, under *Building*: when the diff deletes a `use`, a function or a
public item, rebase onto `origin/<default branch>` before running the fast gate, so that the gate
checks what CI will build.

**Seen before.** No. ah-t8c4 mentions the fast gate catching an unused import, but that was the
opposite direction and caused no CI failure.

## The bead described a fixture that had already been fixed

**What happened.** Forge's bead said the `unit()` fixture "sets `men: 1`, but its item list holds one
grain and no man item". On main that had already been fixed by ah-xi43 (f173df03, #817), six weeks
before the sweep: `unit()` lists a HUMN, and `with_men`/`with_people` keep the headcount in step.
The real remaining work was only the bead's third bullet, the production guards.

**Why.** Not established. The bead quotes retrospectives (ah-titf, ah-1wcw.4) written before #817,
and Forge seems to have taken their description of the fixture rather than reading it at the
sweep's head.

**Cost.** About ten minutes: reading the fixture's history and re-scoping the plan to the guards.

**Prevent by.** In Forge's sweep (`.claude/agents/architect.md`): before a bead quotes the shape of
some code from a retrospective, check that shape at the sweep's head (`git show <head>:<path>`), and
say in the bead what has already been fixed since.

**Seen before.** No.
