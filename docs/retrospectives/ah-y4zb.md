# ah-y4zb — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-24
- **PR:** #661

## `:where()` alone did not defeat the cap, because the cap was unlayered

**What happened.** The plan's whole mechanism was to wrap
`[role="dialog"][aria-modal="true"]` in `:where()` so a dialog's own `max-h-[80vh]` would win. It
did not. `pnpm run test:smoke`'s `the game data dialog stops short of the bottom edge`
(`tests/smoke/shortcuts.spec.ts:714`) measured a margin of 0 against an expected 45 — the same
symptom `ah-vwdi` was reopened for. `packages/shared/src/theme.test.ts` was green throughout, because
the `:where()` it pins was present.
**Why.** Established. Tailwind v4 emits utilities into `@layer utilities`, and `theme.css`'s rules
are unlayered. An unlayered rule beats every layered one regardless of specificity, so zeroing the
specificity changed nothing. The fix is `@layer base { :where(...) { … } }` — `base` cascades before
`utilities`, so the utility wins.
**Cost.** One full 19-minute smoke run to discover it, plus a targeted re-run and a stashed baseline
run to separate it from a pre-existing failure — about 45 minutes. Nothing shipped wrong: the smoke
suite caught it before the PR opened.
**Prevent by.** A plan that proposes a specificity change to `packages/shared/src/theme.css` should
state the layer as well as the selector — in this repository every rule in that file is unlayered
and therefore already beats all Tailwind utilities, which makes specificity alone the wrong lever.
`packages/shared/src/theme.test.ts` now pins the `@layer base` placement alongside the `:where()`,
which is what stops the layer half being tidied away.
**Seen before.** `ah-vwdi` — same block, same symptom, the layer half not yet understood;
`ah-ziv` — the same stylesheet defeating what a component's code says.

## A test pinned the very thing the plan removed

**What happened.** The plan stated the existing `GameDataDialog` tests would pass unedited. One of
them asserted `toContain("max-h-[80vh]!")`, pinning the `!` this bead deletes, so `check:fast` went
red on the increment that was supposed to change nothing.
**Why.** Established, and unsurprising: `ah-vwdi` added that assertion precisely to stop the `!`
being dropped, and nothing in the plan's file survey looked at the test files for assertions on the
strings it was changing.
**Cost.** One extra gate cycle, about five minutes.
**Prevent by.** When a plan removes a token from a className, its *Files to change* should grep the
suites for that literal — here `grep -rn 'max-h-\[80vh\]!' packages/shared/src` finds it in one
command — and say whether the assertion is meant to move with it.
**Seen before.** None found.
