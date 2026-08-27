# ah-zh5i.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-27
- **PR:** #756

## An effect keyed on the state object fired one commit before the DOM it wanted

**What happened.** The plan specified the focus-on-Apply effect keyed on the answer object's
identity: "`AppShell.tsx:2214` calls `setRoute(answer)` with a fresh object for every answer, so
identity is the right key". Built exactly that way, the new smoke test `a planned route puts the
cursor on Apply to orders` failed — focus stayed on the map hex. Instrumenting the effect from
inside the browser showed it firing once, correctly, with `ref=false`.

**Why.** Established. The shell sets the route and clears `busy` in two separate commits, not one.
On the commit the answer arrives `busy` is still true, so `PlannerBody` renders no Apply button and
the ref reads null; on the next commit the button appears but the answer has not changed, so the
effect does not run. The fix keys the effect on `plan` — the value the button's own presence
follows — which by construction cannot run ahead of it.

**Cost.** About 25 minutes: two smoke runs plus a browser-side probe of `document.activeElement` and
of the effect's own firing, written and deleted.

**Prevent by.** When a plan names an effect that touches a ref, it should key it on the value that
*gates that element's rendering*, not on the upstream state the value is derived from — and where
the two differ, say so. Concretely, for this shape: before writing `useEffect(..., [x])` next to a
`{y ? <el ref={r}/> : null}`, check whether `x` and `y` change in the same commit. They do not when
an async handler calls two setters that React does not batch across an `await`.

**Seen before.** `ah-teg0` — the mirror image, an effect keyed on identity firing *too often* rather
than too early. Both are the same underlying thing: a plan that names an effect's key without
saying what else changes in that commit.

## A hand-written copy of another component's props went red only on the merge with main

**What happened.** `UnitMovementSlotProps` wrote out the props it forwards to `UnitPanelBody`. While
this PR was open, `ah-67h8` merged and gave `UnitPanel` a `standing` prop, which `AppShell` passes.
`pnpm run check:fast` was green on this branch and CI's `checks` job failed on
`AppShell.tsx(3622,19) … Property 'standing' does not exist on type … UnitMovementSlotProps`.

**Why.** Established. CI typechecks the merge of the branch with main, and the local gate does not.
Neither side is wrong on its own: main added a prop to a component, this branch added a forwarder
that had a copy of that component's prop list.

**Cost.** One full CI cycle plus an `update-branch`, about 15 minutes.

**Prevent by.** A component that forwards another's props untouched should say so in the type —
`Parameters<typeof UnitPanelBody>[0] & { … }` — rather than restating them. That is what the fix
does, and it is the only version of this that a branch open across somebody else's merge cannot
drift from. Worth a plan's *Files to change* section naming the derivation when it specifies a
wrapper: this plan wrote the forwarded props out longhand, and following it faithfully is what
introduced the copy.

**Seen before.** none found — grepped `docs/retrospectives/` for `Parameters<typeof`, "semantic
conflict", "merge with main" and prop-duplication wording.
