# ah-mlls.4: retrospective

## Main was red because two sibling beads merged past each other

**What happened.** Four children of ah-mlls were built in parallel, and all of them extend the palette's `PaletteInput`.
- ah-mlls.2 (#1614) added a required `settlements` field.
- ah-mlls.1 (#1615) added a required `foreignUnits` field.

Each PR was green against the main it was built on. Once both had merged, `commandPalette.test.ts` held one input from each bead that lacked the other bead's field. Main's `typecheck` failed from #1615 onward. This bead found it while rebasing and fixed it in its own PR (#1618).

**Why.** The repository does not require a branch to be up to date before it merges. `branches/main/protection` answers 404, and `required_status_checks.strict` is not set. So the second PR's CI never ran against the first PR's change. A required field added to a shared input type is exactly the change that breaks a sibling's new call site and nothing else.

**Cost.** One unexpected conflict resolution, a second gate, and a red main until this PR merged. Every other producer branching from main in that window inherited a red typecheck.

**Prevent by.** Pick one, in `.claude/cerebro` producer guidance or repository settings:
- Turn on "require branches to be up to date before merging" for `main`, so `strict` is true and the producer skill's *Merging* section already does the catch-up.
- Or have the planner give fields added to a shared input like `PaletteInput` a default when sibling beads are planned in parallel. An optional field, or a builder helper in the tests, means a sibling's call site needs no edit.

**Seen before.** Yes, in code rather than in a retrospective. `packages/shared/src/workspace/unitSource.ts` (`listShown`, the `foreign` case) records that ah-1mpx.5 and ah-1t41 "merged past each other - main's typecheck was red on the missing case."
