# ah-5jkt.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-19
- **PR:** #469

## The plan's central premise about the data had been overtaken by a bead that shipped after it

**What happened.** The plan states, as one of two "facts established during planning that shape
everything below", that the scraped ruleset "contains no prose at all — not one description, rules
note or flavour line, in any category", that the dialog is therefore "a stat block, and that is the
ceiling", and that `buildings` holds ten fortifications. Reading `config/public/ruleset.json` before
the first test showed 58 buildings, every one carrying a `description`, 167 of 171 items likewise,
and all 96 skills carrying per-level prose. `ah-3cj4` — the bead the plan names as the filed gap,
"not this bead's work" — had landed in between.

**Why.** Established. The plan pinned facts about a file that another bead was queued to change,
and nothing rechecks a plan against the tree at the moment it is claimed.

**Cost.** About ten minutes to establish, and one round-trip to the navigator (an `asking` pause) to
decide whether to show the now-existing prose. Cheap only because it was caught before the first
test rather than after the dialog was built to the stat-block ceiling. The plan's user-facing
"Absent entry" string would have put a false sentence on screen — "Only fortifications were scraped
from the rules page" — had it been implemented as written.

**Prevent by.** `implement-bead`'s *Picking up* could add one step after `bd show <id> --json`: where
a plan states a measured fact about a file in the tree — a count, a shape, an absence — re-measure it
before building, and treat a mismatch as an `asking` question rather than a detail. The plans that
invite this name themselves: this one cited another open bead as the reason for its ceiling, which
is precisely the signal that the ceiling may have moved.

**Seen before.** `ah-goz` — a plan naming an agent "Bishop" after main had renamed it "Forge". Same
shape: a plan accurate when written, overtaken before it was claimed.

## A lower-case sibling module silently shadowed the component it sat beside

**What happened.** The dialog's pure state reducer was written as
`packages/shared/src/workspace/gameDataDialog.ts`, beside the component
`GameDataDialog.tsx`. Every test of the component then failed with React's
"Element type is invalid: expected a string … but got: undefined". On this macOS checkout the
filesystem is case-insensitive, so `import { GameDataDialog } from "./GameDataDialog"` resolved to
the reducer, which exports no component. Renaming the reducer to `gameDataDialogState.ts` fixed it.

**Why.** Established, by logging the resolved module's exports — they were the reducer's.

**Cost.** About ten minutes, spent reading a React error that names neither file and reads as an
export mistake rather than a resolution one. It would not reproduce on the Linux CI runners, so a
mistake in the other direction — the component importing the reducer — could pass locally and fail
only in CI.

**Prevent by.** `implement-bead`'s *Traps this repository has already paid for* wants a line: two
modules in one directory whose names differ only in case resolve to one file on this checkout. When
a component and its pure state live side by side, suffix the state module (`…State.ts`) rather than
sharing the stem.

**Seen before.** None found.
