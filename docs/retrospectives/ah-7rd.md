# ah-7rd — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #404

## `shortcuts.spec.ts:242` "right-click centres the view on a hex" failed in CI again, on a diff that touches no map code

**What happened.** The diff is `packages/shared/src/turnMessages.ts` and
`packages/shared/src/workspace/TurnMessagesPanel.tsx` and their tests — no map, no transform, no
shell. CI was fully green on the first head. After `update-branch` brought main in, the same commit's
`smoke (desktop-shell, 1, 2)` failed on
`expect(mapTransform).toBe("translate(945.09,-103.11) scale(0.5946)")` receiving
`translate(945.09,-102.57)` — 0.54px out, on both the first attempt and the retry. Run locally with
`pnpm run test:smoke -g "right-click centres the view"`, both projects passed in 8 seconds. A
`gh run rerun --failed` was then green.

**Why.** Not established here, and the prior sightings did not establish it either. The assertion is
pixel-exact on a value that depends on the rendered viewport, and the runner evidently lands on a
slightly different one some of the time.

**Cost.** One reproduce-locally run and one job re-run, about eight minutes on top of the
`update-branch` cycle.

**Prevent by.** The assertion should compare the transform within a tolerance rather than by string
equality — `tests/smoke/shortcuts.spec.ts:275` and `:293`, both via `mapTransform`. That is a change
to a test outside any planned bead, so it is the navigator's to make; this file is the fourth
independent sighting of it, which is the argument for making it.

**Seen before.** ah-1uj, ah-l2i.2, ah-do8.3 — the same spec, the same sub-pixel transform, the same
"diff touches no map code".
