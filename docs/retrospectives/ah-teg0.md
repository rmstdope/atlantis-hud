# ah-teg0 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-23
- **PR:** #577

## Normalising a value where it is read broke an effect keyed on that value's identity

**What happened.** The plan's chosen design applies a correction in `mapShapeOfGame`
(`packages/shared/src/mapShape.ts`) so every reader of a game's map sees the drawable version.
Implemented straightforwardly, the helper built and returned a new object on every call. Nothing in
`packages/shared` noticed: all four increments were green and `pnpm run check:fast` passed. CI then
failed both shard-1 smoke jobs on `tests/smoke/settings.spec.ts:440`, "a corrected map size is still
there when settings are reopened" — a width typed into Settings > Per game reverted to its old value
before the blur committed.

**Why.** `GameMapSettings` resyncs its draft in a `useEffect` keyed on `[map]`, comparing by object
identity. A fresh object per call makes that effect run on every render of the dialog, and its
`setDraft(draftOf(map))` discards whatever the player has typed. The fix is one branch: return the
recorded object itself when nothing needs turning off.

**Cost.** One CI cycle, about 20 minutes.

**Prevent by.** When a plan says a value is normalised *where it is read*, the plan's *Known traps*
should say whether any consumer keys an effect, memo or dependency array on that value's identity —
this plan already told me to read the resync effect before changing `commit`, and the same warning
applied to the read path it never mentioned. Practically: `git grep` the normalised getter's callers
for `useEffect`/`useMemo` dependency arrays before returning a new object from one, and prefer
returning the input unchanged in the common case.

**Seen before.** none found — grepped `docs/retrospectives/` for referential-identity wording.
