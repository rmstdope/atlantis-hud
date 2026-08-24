# ah-7l1c — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-24
- **PR:** #678

## The plan's Validation commands cannot pass from the worktree they are meant to be run in

**What happened.** The plan's *Validation* section listed
`.claude/cerebro/scripts/project-conf launch_targets` and
`.claude/cerebro/scripts/app-paths --classify ...` as pre-PR checks. Run from the bead's own
worktree, after the fix was complete and correct, both still failed exactly as they had before
the change:

```
$ .claude/cerebro/scripts/project-conf launch_targets
project-conf: the declaration has moved - run: mv .claude/cerebro-project.conf .cerebro/project.conf
rc=2
```

For a bead whose whole failure mode is "a commit that looks right and ships nothing", a validation
step that fails on a correct fix is the worst possible signal — it reads as the fix not working.

**Why.** Established. `scripts/project-conf:53` resolves its root with `consumer-root --shared`,
deliberately, so the fleet's configuration is one answer per checkout rather than one per worktree.
The shared root is the *main* checkout, which still had the file at the old path and will until this
merges. The same holds for `disk-preflight` (rc=2, silent) and `gate_fast`, both of which read
`project-conf`. Nothing about it is a defect; it is just invisible from where the plan asked me to
look.

**Cost.** About fifteen minutes: the first validation run read as a failed fix, and proving otherwise
meant `git clone`-ing the branch to a temporary directory, initialising the submodule there, and
re-running every check. That clone is also the only place the plan's own fresh-clone "human check"
could be performed, so the work was needed either way — the cost was not knowing that in advance.

**Prevent by.** A plan whose change is to a file read through `consumer-root --shared` — anything
under `.cerebro/` that `project-conf`, `app-paths`, `disk-preflight` or `roster` reads — should say
so in *Validation* and name the throwaway clone as the place to run the checks:

```bash
T=$(mktemp -d); git clone --branch <branch> <repo> "$T/c"
cd "$T/c" && git submodule update --init --recursive
```

`ah-qled.7.2` reached the same conclusion for a conf *key*; this is the same mechanism for the conf
*file*, which suggests the note belongs in `.cerebro/traps.md` rather than in each plan that
stumbles on it. That is the navigator's call, not mine.

**Seen before.** `ah-qled.7.2` — "A conf key added on a branch has no effect until it merges", same
`--shared` resolution, same invisible-from-the-worktree symptom.
