# ah-6yj2 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-08-23
- **PR:** #584

## A `useRef` mirror of React state is one render behind at the exact moment an awaited fetch resolves

**What happened.** The plan's fix was: keep `rulesetRef.current = ruleset`, await a promise that
settles when the ruleset fetch does, then parse with `rulesetRef.current`. Built exactly as
written, the reproduction still failed. Browser logging showed the parse resuming with
`rulesetRef.current.status === "loading"` immediately after the fetch had resolved and called
`setRuleset({status:"ready"})`.

**Why.** Established. The promise settles in a `.then` on the fetch chain; the ref is only
reassigned during a render, and React had not re-rendered yet at the microtask the awaiting load
resumed in. The ref is a mirror of state, so it is stale for precisely the window the wait was
built to cover — the plan's own trap note ("a closure captures the ruleset at the moment the
callback was built") names the shape of the problem but the ref does not actually solve it. The
fix is for the settled state to *travel with the promise*: `Promise<RulesetState>` resolved by the
fetch with the value it just fetched, with the ref kept only as the fallback for the ceiling case.

**Cost.** About 40 minutes and six smoke runs, spent instrumenting the browser with `console.log`
to find where the value went stale. There is a second, identical instance in the same run: with the
parse fixed, the units were still tilde'd, because `loadTurn`'s `rulesetText` argument is derived
from the same render-behind state, so the *memory commit* stored every hex unclassified and the
table showed those. Two layers, one cause.

**Prevent by.** When a plan says "read the latest value through a ref from a callback", check
whether the value is React state and whether the read happens inside an `await` of something that
*sets* that state. If both, the ref cannot work — the value has to be carried on the thing being
awaited. Worth a line in the traps file: a `useRef` mirror is fresh at render time, not at
promise-resolution time.

**Seen before.** `ah-o1t.2` — a different mechanism (zustand's server snapshot) but the same class
of mistake: assuming a mirror of state is current at a moment React had no reason to have updated
it.

## A status line the whole application shares is asserted on by walks that have nothing to do with it

**What happened.** `pnpm run check:fast` was green and `workspace.spec.ts` was green locally, but
CI failed two walks in other files: `shortcuts.spec.ts` (a deliberate 404 ruleset, whose load now
says so instead of counting the turn) and `persistence.spec.ts` (which used "restored turn 71" as
its proof that a restore had landed, an ordering the import's new wait reverses).

**Why.** Established. Both walks read `import-status` as an incidental synchronisation point rather
than as their subject, so a change to what a load says reaches specs that are about keyboard doors
and about saved orders.

**Cost.** One CI cycle, about fifteen minutes.

**Prevent by.** A bead that changes what the header says should grep the whole smoke suite for
`import-status` before pushing, not only the spec it is adding to — the same reflex the traps file
already asks for around accessible names. The plan's *Validation* named only
`workspace.spec.ts`, which is what made the local run look conclusive.

**Seen before.** `ah-dwk6` — a change whose blast radius reached smoke specs the plan did not name,
found by CI rather than locally.
