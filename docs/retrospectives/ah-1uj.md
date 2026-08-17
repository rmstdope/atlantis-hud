# ah-1uj — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-17
- **PR:** #352

## Several beads landing header chips in quick succession broke pixel-exact smoke tests that had never failed before

**What happened.** `study-at-maximum` makes the committed turn-71 fixture carry a genuine finding
(unit 13402) on every load, so the header's problems chip - previously empty and invisible for this
fixture - is now always present. Over the course of merging this one bead, main also gained a Trade
chip (`ah-1j5.2`), `give-target-not-here`, `not-traded-here`, `unit-overloaded` and
`too-many-quartermasters` (all adding to the same settings/header surface), each landing minutes
apart while this PR was rebasing onto them one at a time. The combined header growth - not any one
change alone - pushed several *unrelated, previously rock-solid* smoke tests past pixel thresholds
they had never come close to before:

- `persistence.spec.ts`'s "a turn landing in the open game leaves the map where it is" - a genuine
  bug in `MapCanvas.tsx`'s "follow the selection into view" effect, which reacted to a bare container
  resize (the header growing) as if it were a new selection, permanently shifting the pan.
- `shortcuts.spec.ts`'s wheel-gesture test - a fixed pixel corner coordinate landed on the header
  once the problems chip pushed the map down.
- `workspace.spec.ts`'s badge-menu note-toggle - the same chip growth pushed a tall popover's anchor
  down far enough to overlap the units-pane splitter below it, a real click-interception a mouse user
  would also hit.
- `workspace.spec.ts`'s two panel-drag tests - at the smoke suite's default 1280x683 window, the
  orders editor's pinned height was already sitting at the ceiling `dragOrdersHeight` computes from
  the shrunk rail, so dragging it taller had nowhere to go at all. Confirmed by measuring the panel's
  resting height directly: it stayed exactly at its ceiling regardless of drag distance.

Each was fixed individually as it surfaced (four separate CI round trips, several of them only
reproducing on CI's Linux Chromium and never locally on macOS), but they were all the same
underlying shape: a test written when the header had room to spare, now living at the edge of a
budget several beads are spending from at once.

**Why.** No single bead's header growth was enough on its own - each landed against a green CI on
its own PR. It is the *sum* of several concurrently-developed advisory checks (all following the
established pattern of adding a settings entry, several adding no header chip at all) plus one
always-visible chip (Trade) accumulating in the same short window that crossed several tests'
margins for the first time. `study-at-maximum` happened to be the one PR in flight while enough of
them landed at once to tip it over, not the sole cause.

**Cost.** Roughly four extra CI round trips (~40 minutes) and several hours of local diagnosis across
the session, on top of the feature's own review cycle. Most of that cost was in *finding* the cause
each time - none of the fixes, once understood, were large.

**Prevent by.** The smoke suite's fixed 1280x683 window is not a policy anyone decided on for
"how much header a page can carry" - it is just Playwright's `devices["Desktop Chrome"]` default, and
several tests unknowingly depend on it having slack. Two independent mitigations would each have
caught this earlier and cheaper than a CI round trip per symptom:
1. A CI job (or a single smoke test) that asserts the header/chip strip stays under some height
   budget at the default window size, so *the* header-growth regression is caught once, in one place,
   the moment any PR crosses it - rather than N different tests failing for what looks like N
   unrelated reasons.
2. Fix `MapCanvas.tsx`'s effect scope: the "follow selection into view" bug (a bare resize
   mistaken for a new selection) is real and is now fixed by this bead, but it is the kind of thing
   worth a unit test of its own rather than only the smoke-suite discovery that found it here.

**Seen before.** None found (`grep -rl "header\|chip" docs/retrospectives/` turned up unrelated
findings).

## The retrospective for this bead was written after the PR had already merged

**What happened.** The bead's own PR (#352) merged clean with everything above already fixed and
green, but the retrospective itself was not written until after `gh pr merge` had run and the branch
was gone - directly against `implement-bead`'s own instruction that it belongs in the bead's PR
*before* the merge, precisely because there is no branch left to put it on afterwards. It had to be
recovered as a second, small, independently-reviewed PR just for this file.

**Why.** The CI cycle in this run was unusually long (several red rounds, each requiring local
diagnosis before the next push), and by the time every check was finally green the retrospective
step - which the skill places *after* CI is green and *before* the merge command - was skipped past
straight to merging, on the reasoning "everything is green, ship it" rather than following the
skill's own ordering.

**Cost.** One extra PR, one extra Copilot review cycle, one extra CI run - all avoidable by reading
the skill's step order rather than its content in isolation.

**Prevent by.** Treat "CI is green" as the cue to open the retrospective question, not the cue to
merge - the skill's own heading order (*The retrospective*, before *Finishing*) already says this;
it was just not followed here under the pressure of a long, eventful run.

**Seen before.** None found.
