# ah-mlls.8: retrospective

## Two sibling beads each built a greyed palette row, with different looks

**What happened.** ah-mlls.7 (Import, Fetch and Send) and ah-mlls.8 (the mage sheet) were built at the same time. Each needed the command palette's first greyed row: listed, never highlighted, skipped by the arrows, inert on Enter.
- Each UX session agreed its own look. ah-mlls.7 put the reason beside the label, wrapping. ah-mlls.8 put it on the right in the count slot, cut short with "…".
- Each producer built its own mechanism. ah-mlls.7 used `unavailable`, `settleHighlight` and `enabled`. ah-mlls.8 used `disabled`, `paletteActiveIndex` and `blocked`.

ah-mlls.8 was reviewed, answered and green when ah-mlls.7 merged. The catch-up rebase then conflicted in four files, and the duplication only showed up then.

**Why.** The two siblings were agreed and planned as though each were alone. Neither acceptance mentions the other. Nothing at the UX or planning stage asks whether a sibling under the same parent is introducing the same new kind of row or state.

**Cost.**
- A navigator question to choose between two already agreed looks.
- The branch rebuilt from main, with most of its diff and tests thrown away.
- A second gate, a second smoke run, a second full review and a second CI cycle. About an hour.

**Prevent by.** At the UX stage (`agree-experience`), when a bead introduces a new kind of row or state in a shared surface, list the open siblings under the same parent that touch that surface. Agree the shared piece once, in whichever bead comes first, and record it as a dependency (`bd dep add`) so the second bead builds on it rather than beside it.

**Seen before.** Related but not the same: `docs/retrospectives/ah-mlls.4.md` records siblings in the same epic merging past each other on `PaletteInput`. That was a type break. This is a duplicated design.
