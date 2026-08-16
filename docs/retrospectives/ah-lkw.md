# ah-lkw — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-16
- **PR:** #304

## Three `AppShell.tsx` effects were keyed on the whole `game` object, not on what they actually read

**What happened.** The plan's `renameGame` handler, mirroring `changeRuleset` exactly as written,
called `setGame({ ...game, manifest: result.manifest })` after a successful rename. That alone made
the "renamed in place" smoke test flaky: `expect(page.getByTestId("rename-game")).toBeFocused()`
failed with the button reading "inactive" a moment after being focused. Tracing it with a
`MutationObserver` and manual focus-event logging showed the Rename button's DOM node was being
recreated (or its ancestor tree churned) shortly after the effect that restores focus ran.

The cause: three `useEffect`s in `AppShell.tsx` were keyed on `[game]` — the ruleset-fetch effect,
a hex-notes-load effect, and the "restore latest turn" effect (which calls `setBusy(true)`, does a
full report re-parse, then `setBusy(false)`). All three fire on *any* new `game` object, not only
on a genuine game switch or ruleset change. A rename hands the shell a fresh `game` reference (as
it must, to make React re-render the new name), which was enough to re-trigger a ruleset refetch,
a turn re-parse, and — critically — a `busy` flip that disabled every button in the picker,
including the just-focused Rename link. Disabling a focused element blurs it, and nothing
refocuses it afterward.

The first fix (keying the effects on `openGameId` + `rulesetId` instead of `game` identity)
resolved the rename flow but broke a *different*, pre-existing smoke test:
`"importing a backup of a game that is already here can replace it"`. A `replace` import keeps the
same game id (and can keep the same ruleset id) while completely swapping out the database
underneath it — exactly the case `openGameId`/`rulesetId` alone cannot distinguish from a rename.
The eventual fix added a `gameEpoch` counter, bumped only by `enterGame` (which every open/create/
import path — including `replace` — goes through, and which `changeRuleset`/`renameGame` do not),
and keyed the three effects on the fields they read plus `gameEpoch`.

**Why.** These effects were originally written assuming `game` identity change ⟺ "the player is now
looking at different data" — true for every action that existed at the time (open, create, import,
change ruleset all reconstruct or genuinely change what the database holds). A rename breaks that
assumption: it is the first action that legitimately produces a new `game` object while nothing the
three effects care about (game id, database path, ruleset id, ruleset text) has changed.

**Cost.** About two hours: reproducing the focus loss with `MutationObserver`/focus-event
instrumentation, a first fix that passed the new tests but silently broke an existing one 30
smoke-tests later, and a second, more careful fix (the `gameEpoch` counter) plus a second full
smoke run to confirm both scenarios pass together.

**Prevent by.** When a plan's design says "hand `setGame` a fresh object, the same as X does" for a
new action, check what *else* is keyed on `game`'s identity (`grep -n '\[.*\bgame\b' AppShell.tsx`
for `useEffect`/`useCallback` dependency arrays) before assuming the reuse is safe - an object
identity used as an effect dependency is an implicit "this changed" signal that a new action can
trip without meaning to. Worth a note in `plan-bead`'s known-traps guidance for any bead touching
`AppShell.tsx`'s game-switching machinery.

**Seen before.** None found (`grep -rl "gameEpoch\|keyed on.*game\b" docs/retrospectives/` before
writing this file turned up nothing).
