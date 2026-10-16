# ah-mlls.3 — retrospective

- **Producer:** Rogue
- **Date:** 2026-10-16
- **PR:** #1619

## Four sibling beads each widened the palette's required input, and main went red between them

**What happened.** ah-mlls.1, .2, .3 and .4 are children of one epic (ah-mlls), built at the same
time by different producers. Each one added a required field to `PaletteInput` in
`packages/shared/src/commandPalette.ts` (`foreignUnits`, `settlements`, `factions`, `armies`) and
each updated only its own `buildPaletteEntries(...)` calls in `commandPalette.test.ts`. #1614 and
#1615 merged one after the other, both green against their own base. `main`'s CI concluded
`failure` at 6aceca68: each sibling's new test call lacked the other's field. This PR then hit
merge conflicts twice, once after .1 and .2 landed and again after .4. Both rounds conflicted in
the same five files, because .1 had also taken the names this bead's plan used
(`PaletteEntry.faction` and the type `PaletteFaction`), so this bead's fields had to be renamed
during the merge.

**Why.** Established: a semantic conflict that git merges without a marker, the same as ah-8n8y
and ah-agze. `main` has no branch protection (the protection endpoint answers 404), so nothing
re-tests a PR against the head it lands on. The plans were written and built in parallel against
the same base. None of them named the shared files, the shared input type, or the sibling beads
working on them.

**Cost.** About forty minutes on this bead: two merge resolutions across five files, the renames,
re-applying the row rendering on top of .1's flat-row layout, and the gate and smoke suite run
three times. `main` stayed red from #1615 until this PR merged.

**Prevent by.** The two options ah-agze and ah-8n8y already name, still the navigator's to choose:
`strict` required checks on `main`, or Cerebro's sweep alarming when `gh run list --branch main`
concludes `failure`. One step is specific to this case: when an epic's children all extend the
same type, the epic's ranking could chain them with `bd dep add`, so they build one after another
rather than all at once.

**Seen before.** `ah-8n8y.md` and `ah-agze.md`: the same semantic conflict under the same missing
protection. This is the first time it happened across sibling children of one epic.
