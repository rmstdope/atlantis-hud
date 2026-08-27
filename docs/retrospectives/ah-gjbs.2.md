# ah-gjbs.2 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-27
- **PR:** #749

## The plan asked for a click test on a component that has to own hooks

**What happened.** The plan's increments 6–8 said to reach `magic-graph-skill-CRRI` with
`findByTestId(<MagicGraphView …/>, …)`, and increment 9 said the same of
`magic-tree-view-graph` inside `MagicTreeDialog`. Neither is reachable. `elementTree`'s walk enters
a component by *calling* it, which works only while it uses no hooks — and both of those components
must own hooks, one for the viewport and the gestures, the other for the highlight and the
scroll-into-view effect. The dialog's version failed as

    No element with data-testid="magic-tree-view-graph" in this tree.
    The walk could not enter: MagicTreeDialog.

after a run of `Invalid hook call` on stderr.

**Why.** `.cerebro/traps.md` and `packages/shared/src/testing/README.md` both state the rule about
**effects** — a static render runs none, so no test here may assert what one did. The rule about
**entry** is a separate consequence of the same missing jsdom and is written only in
`elementTree.ts`'s own doc-comment: a hook in the component under test makes its ids unreachable,
whether or not the assertion is about an effect. A plan can therefore satisfy the trap it was
warned about and still specify an impossible test, which is what happened twice here.

**Cost.** About twenty minutes: two RED runs diagnosed, one component split into a hook-free
`MagicGraphDrawing` and a hooked `MagicGraphView` to make increments 6–8 possible at all, and
increment 9's click assertion dropped in favour of markup assertions plus the smoke spec.

**Prevent by.** `plan-bead`'s rule about `packages/shared` should say both halves, not one: a plan
that names a `*.test.tsx` there must not ask it to observe an effect **and** must not ask it to find
an id inside a component that will use hooks. Where a plan wants a click asserted on a component
that owns state, the plan itself should specify the hook-free/hooked split — as this one ended up
needing — rather than leaving the implementer to discover it. `.cerebro/traps.md`'s
"Never ask for an effect-level test in `packages/shared`" entry is the natural place to add the
second sentence.

**Seen before.** `ah-pdly` is the same wall from the other side — a hook *added* to `PopoverFrame`
turned two existing element-tree walks red. Nothing yet records a **plan** specifying the
unreachable test, which is the half that is preventable at planning time.

## The eight-times-recorded local smoke failure is now nine

**What happened.** `pnpm run test:smoke` reported 547 passed, 2 flaky and 3 failed. Two of the three
were `workspace.spec.ts › the faction view uses the window before it scrolls`, on both `web` and
`desktop-shell`; the third (`a planned route can be written into the unit's orders`) passed on the
isolation run and was flake. I established the faction-view pair was not mine exactly as the
previous eight did: `git stash push -u`, run the single spec, watch it fail identically with the
change gone, `git stash pop`. CI on `main` is green.

**Why.** Not established here, and deliberately not investigated further — the test asserts
`panelBox.y + panelBox.height <= 720` against a hard-coded window height, so it is a machine-local
discrepancy rather than anything about the repository.

**Cost.** About fifteen minutes: one full 12.7-minute suite read carefully, then a 1.1-minute
isolation run.

**Prevent by.** The entry `ah-gjbs.1` proposed one bead ago — this failure named in
`.cerebro/traps.md`, so the next implementer reads it instead of re-deriving it — is still the
whole of the fix, and it is the navigator's to accept (Forge proposes, the navigator accepts;
nothing else writes that file). Nine implementers have now each spent a quarter of an hour proving
the same negative.

**Seen before.** `ah-bkjd`, `ah-9ess`, `ah-brgo.1`, `ah-brgo.1-reopened`, `ah-2a96`, `ah-o2li`,
`ah-z31p`, `ah-gjbs.1` — eight files, all the same spec, all the same conclusion.
