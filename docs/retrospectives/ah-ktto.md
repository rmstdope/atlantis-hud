# ah-ktto — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-27
- **PR:** #750

## A `finally` that never ran, and a validation step that could not see it

**What happened.** The plan's `invokedDirectly` block put `process.exit(1)` on each failure path
inside `try { … } finally { rmSync(into, { recursive: true, force: true }) }`, and its *Validation*
step 5 asserted the `finally` "removes it, on the failure paths too, which step 2 already
exercised". It does not. `process.exit` terminates the process where it stands and unwinds nothing,
so the `finally` never fires and the temporary export tree leaked on every red run — which for this
gate is every run an implementer will actually care about.

It was found only by accident. Validation step 5 as written was:

    ls -d /tmp/atlantis-generated-* 2>/dev/null; echo "found $?"

which printed `found 1` and would have been recorded as a pass. On macOS `os.tmpdir()` is
`$TMPDIR` — `/var/folders/…/T/` — not `/tmp`, so that glob could never have matched whether the
cleanup worked or not. Re-running it against `"${TMPDIR:-/tmp}"` found
`atlantis-generated-HzX3oF` still on disk from validation step 2.

**Why.** Established, both halves. `process.exit()` not running `finally` is documented Node
behaviour. The `/tmp` mismatch is that the plan wrote a literal path where the code under test uses
`os.tmpdir()`; the two agree on Linux (CI) and differ on macOS (every implementer here).

**Cost.** About ten minutes: reading the leaked directory, restructuring the CLI block into a
non-exported `checkGenerated(root, into): number` that returns an exit code so the caller's
`finally` genuinely runs, and re-running validation steps 1, 2 and 5. No CI cycle — it was caught
before the first push.

**Prevent by.** Two specific things, both for `plan-bead`:

1. A plan that specifies `process.exit` inside a `try`/`finally` is specifying a cleanup that will
   not happen. Where a plan hands an implementer an `invokedDirectly` block verbatim — as this one
   did, and that verbatim block is otherwise a strength — the exit path and the cleanup path have to
   be reconciled in the plan, not discovered at validation. Returning an exit code and calling
   `process.exit` once, after the `finally`, is the shape that works.
2. A *Validation* step must exercise the same expression the code does. This one hard-coded `/tmp`
   against code calling `os.tmpdir()`, so it was a step that could only ever print the passing
   answer. Where a plan's validation greps a path the implementation computes, it should name the
   computed form (`"${TMPDIR:-/tmp}"` here) or say how to derive it.

Worth noting what did work: the plan was otherwise unusually complete, and its *Known traps*
section — particularly the temporary tree having to mirror `EXPORT_DIR`'s depth exactly, and
`repositoryRoot()` being the wrong tool from inside a worktree — saved this run from at least two
mistakes that earlier beads paid for.

**Seen before.** None found. `grep -rl "process.exit" docs/retrospectives/` names `ah-5pp.md`, but
that is a different finding (a predicate conflating "session live" with "buffer owned"), and
nothing in the directory mentions `tmpdir` at all.
