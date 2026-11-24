# ah-iw3n8 — vitest 3 to 5 (Dependabot #1981)

## A red check hid most of the failures

**What happened.** The bead named one failing check, `checks`, with two typecheck errors. Once those were fixed, the local fast gate failed 23 more tests in `packages/shared/src/workspace/SettingsDialog.test.tsx`. A `describe` block had been pasted inside the `tag()` helper, so it was registered from inside every test that called `tag()`. vitest 3 silently ignored it, so its test never ran; vitest 5 rejects it.

**Why.** The `checks` job stops at the first failing step, and typecheck runs before the tests, so CI never reached them.

**Cost.** One extra gate cycle (about ten minutes). It also showed that the "Settings dialog width" test had been dead under vitest 3.

**Prevent by.** For a dependency bump bead, run the full `pnpm run check:fast` on the PR branch before the first fix, not just the step CI names. `skills/fix-bug` *A bead that names a Dependabot pull request* could say "the red check is where the reproduction starts, not the whole of it".

**Seen before.** Nothing like it yet.

## fix-bug and CLAUDE.md disagree about who merges a Dependabot PR

**What happened.** `skills/fix-bug` says the bugfixer merges the Dependabot PR it fixed. CLAUDE.md's *Four eye Principle*, second exception (arriving from main mid-bead), says `dependabot-sweep` is the only thing that merges one and no other session merges or reviews it. The navigator had to be asked; they chose the bugfixer merges.

**Why.** The CLAUDE.md exception was written for green Dependabot PRs without carving out the red ones the sweep files as bugfix beads.

**Cost.** One navigator question at the merge.

**Prevent by.** CLAUDE.md's second exception should name the bugfix-bead case: a red Dependabot PR filed as a bead is merged by its bugfixer after review, as `skills/fix-bug` says.

**Seen before.** Nothing like it yet.
