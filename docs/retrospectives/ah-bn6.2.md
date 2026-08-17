# ah-bn6.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-18
- **PR:** #416

## `Control+z` in a smoke test does nothing on macOS, and reads as a broken feature

**What happened.** The plan's increment 5 says "press `Control+z` once and assert the last word is
back". Written literally, the assertion failed with the document unchanged — the undo never
happened. CodeMirror's `historyKeymap` binds `Mod-z`, which is Cmd on macOS, so the synthesized
Ctrl chord matched nothing. The rest of `tests/smoke/orders-editor.spec.ts` already uses
`ControlOrMeta+z`; swapping to it made the test pass unchanged.
**Why.** Established: the platform keymap. The failure is silent — no error, just an editor that
ignores the chord — so it looks exactly like the feature under test not working, which is what made
it cost more than it should have.
**Cost.** Two smoke cycles, roughly 20 minutes, most of it spent doubting the editor extension
rather than the test.
**Prevent by.** `plan-bead` should write `ControlOrMeta+…` whenever a plan prescribes a keyboard
chord for a smoke test, never a bare `Control+…`. The existing spec's own convention is right; the
plan quoted a chord that contradicts it.
**Seen before.** None found (`grep -l "ControlOrMeta" docs/retrospectives/` is empty).

## A `userEvent: "input.type"` on a synthetic edit hands the player the wrong undo

**What happened.** The uppercasing transaction was dispatched with `userEvent: "input.type"`, which
seemed right — it *is* an input. CodeMirror's history joins adjacent `input.type` events, so one
`Ctrl+Z` swallowed the whole typed word instead of handing it back as typed. That is the exact
behaviour the bead's chosen option T1 was accepted despite, so it would have shipped as the thing
the navigator asked not to happen.
**Why.** Established, by reading `@codemirror/commands` history grouping: joining is keyed on the
user event. Dropping the field entirely makes the change its own undo step.
**Cost.** One smoke cycle, about 10 minutes.
**Prevent by.** A plan that promises "one undo press" for an editor change should say what user
event the transaction carries, not only that it is one transaction — one transaction is necessary
but not sufficient, because history groups across transactions.
**Seen before.** None found.
