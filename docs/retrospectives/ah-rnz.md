# ah-rnz — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-15
- **PR:** #8 (rmstdope/cerebro)

## `declare -A` silently misparses on the default bash the plan's own test target ships with

**What happened.** `tests/launchers.sh` (the cerebro submodule's first shell test) used a
`declare -A` associative array to pair each role launcher with its expected `BEADS_ACTOR`. Under
the `bash` on `$PATH` (Homebrew bash 5, used to write and first run the suite) it worked. Run
through `bash tests/launchers.sh` — which resolves to the OS-default `bash` when a caller doesn't
pin one — it failed with `tests/launchers.sh: line 85: run: unbound variable`, not a syntax error.
macOS ships bash 3.2, which has no `declare -A`; it treated the array subscript `[run-planner]` as
an arithmetic expression and tried to evaluate `run` and `planner` as integer variables.

**Why.** bash 3.2's `declare` silently accepts (or ignores) an unsupported `-A` and falls back to
indexed-array assignment syntax, so `[run-planner]=Xavier` is read as an arithmetic subscript rather
than erroring as "unknown option". The failure surfaces two lines later, as an unrelated-looking
"unbound variable", which does not point back at the associative array at all.

**Cost.** About five minutes: one failed run, a `bash -x` trace to find the real cause, rewritten
as two parallel indexed arrays instead.

**Prevent by.** Any new shell test added to this submodule should avoid `declare -A` (or anything
else that needs bash 4+) and use parallel indexed arrays or case statements instead, since this repo
has no CI to catch a bash-version mismatch before merge and the implementer's own machine may not
default to the same bash the test will actually run under. Worth a line in `tests/launchers.sh`'s
own header once a second test file exists, so the constraint is visible where the next one is
written rather than only in this file.

**Seen before.** none found.
