# ah-tguk — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-28
- **PR:** #786

## A dependency added to a shared memo broke a source the bead never touched

**What happened.** The plan's *Known traps* named row-array identity as load-bearing for the unit
tooltip, and put the guard on `mergePreviewAcross`'s return value — the `toBe` assertions in the
test plan, which I wrote and which pass. I then wired the fold the way the plan spelled out: the
`own` branch of `UnitTableDock`'s `sourced` memo, with `ordersPreview` appended to its dependency
array. Everything went green — the four unit files, `pnpm run check:fast`, and the new smoke case.
The full smoke suite, which I ran by choice, failed
`tests/smoke/workspace.spec.ts` › `resting on a unit row summarises it` on both projects and both
retries: the `This hex` tooltip never opened.

**Why.** Established. `sourced` is one memo shared by all four sources. `ordersPreview` is a fresh
object on every one of the shell's 300ms debounce ticks whether or not the orders changed anything,
so adding it to that dependency array re-ran the memo constantly — and the `hex` branch builds its
rows with `unitsForHex(hex)`, a fresh array each call. `visible` is memoised over those rows and the
effect at `UnitTableDock.tsx:604` cancels a pending hover whenever `visible` changes identity, so it
fired every 300ms and the tooltip was never due. The identity guarantee the plan protected was on
the *value returned*; what broke was the *dependency that decides whether the memo runs at all*.
Fixed by folding in a separate memo gated on the source, so every other source gets the very same
`ownUnits` array back and `sourced` does not re-run.

**Cost.** About 25 minutes: one full local smoke run (10.4 min) to find it, the diagnosis, one extra
commit and push. No CI cycle was wasted — the fix went out before the first CI run finished — but
the merge would have been red without the local run, since CI runs the same suite.

**Prevent by.** Two specific things.

1. **`plan-bead`'s treatment of a memo identity trap should cover the dependency array, not only
   the return value.** A plan that says "add X to the dependency array at `<file>:<line>`" is
   changing when *every* branch of that memo re-runs. Where the memo is shared by several sources
   and any other branch builds a fresh array or object, the plan should say to gate the new
   computation in a memo of its own — or say explicitly that it checked the other branches. This
   plan's *Known traps* had the right fact and pointed it at the wrong place.
2. **A bead that touches `UnitTableDock`'s row memos should run the full smoke suite before the PR
   opens, not by choice.** `pnpm run check:fast` cannot see this class of defect at all —
   `packages/shared` has no jsdom, so no test there runs an effect — and
   `resting on a unit row summarises it` is the only thing in the repository that does. Worth the
   `.cerebro/traps.md` entry saying so beside the existing jsdom trap, since the plan's *Suites to
   run* section here said the browser suites "run in CI", which is true and was not enough.

**Seen before.** `docs/retrospectives/ah-1wcw.6.md` — the same spec, the same effect at `[visible]`,
the same 300ms debounce, a different route in (a `useMemo` early-out returning a fresh `new Map()`;
here a dependency added to the memo above it). Its *Prevent by* item 2 already names the
returned-fresh-empty shape; this is the second shape, and the third sighting of the mechanism
counting `ah-1wcw.1`.
