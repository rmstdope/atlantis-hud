# ah-pdly — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-23
- **PR:** #576

## Adding a hook to a shared component turned two unrelated test files red

**What happened.** `PopoverFrame` gained `useRef`/`useEffect` so it could take focus when it opens.
`pnpm run check:fast`'s test leg then failed with nine reds in
`packages/shared/src/workspace/FactionDossierPanel.test.tsx` and none of them about focus:
`TypeError: Cannot read properties of null (reading 'useRef')`. Both that file and
`TradePanel.test.tsx` walk an unrendered element tree by calling components as plain functions
(`element.type(element.props)`), which React forbids the moment the component uses a hook. Neither
file is named anywhere in the bead, and the plan's promise of "one change in one file" is what made
the red look like a mistake rather than a consequence.

**Why.** Established. `packages/shared` has no jsdom, so those two files reach a nested element by
invoking components directly instead of rendering; a hook anywhere below the walk's entry point
throws. Fixed by having the walk fall through to the component's children when the call throws —
every id either file asks for sits inside the frame, never on it.

**Cost.** About twenty minutes, one full `check:fast` cycle, and a stretch of reading nine failures
that named neither the cause nor the file that caused them.

**Prevent by.** `packages/shared/src/testing/README.md` is the document an implementer is pointed at
for this package, and it says the panel components must stay hook-free — but only in passing, about
`FactionDossierPanel`. It should say the general rule out loud: **a hook added to any component that
`FactionDossierPanel.test.tsx` or `TradePanel.test.tsx` walk through will turn those files red with
an invalid-hook error that names neither the walker nor the cause.** A plan that adds a hook to a
shared component should name the walkers under *Known traps*; ah-pdly's plan named the no-jsdom
constraint and still missed this, its second sighting.

**Seen before.** `ah-mwqa` — same walker, same invalid-hook error, same package.

## The plan's effect snippets were subtly wrong about React's ordering, and both were shippable

**What happened.** The plan carried two ready-to-paste `useEffect` blocks. Both compile, read
correctly, and are wrong. The open half captured `document.activeElement` in a `ChipPopover` effect
to remember what to return to — but React runs a child's effects before its parent's, so
`PopoverFrame` had already focused the panel and the "chip" remembered was the panel about to
unmount. The close half then asked `wrapperRef.current?.contains(document.activeElement)` to decide
whether focus was still its own — but by the time that effect runs the panel has been removed and
focus has fallen to `<body>`, so the test never passes and nothing was ever restored. Three smoke
rounds went by before both were understood; the shipped code answers both questions **during
render**, before the commit.

**Why.** Established, by reading the failures against React's documented effect ordering. Not
something the plan could have caught by inspection — it reads as obviously correct.

**Cost.** Three smoke cycles, roughly twenty-five minutes.

**Prevent by.** A plan should give the *design* of a focus-restore — what is remembered, when, and
what the exemption is for — rather than pasteable effect bodies. Literal code in a plan is followed
literally, and a wrong snippet costs more than no snippet: the first round here was spent trusting
it. Where `plan-bead` does supply code for anything touching focus, mount order or unmount, it is
worth one line saying the ordering has not been verified in a browser.

**Seen before.** None found for the ordering itself.

## `git checkout <file>` to strip a probe threw away six tests

**What happened.** A temporary `console.log` probe was added to `tests/smoke/workspace.spec.ts` to
find out where focus actually landed. `git checkout tests/smoke/workspace.spec.ts`, run to remove
it, discarded every uncommitted change in that file — all six of the bead's new smoke tests, which
were written and passing but not yet committed because the last increment was still red.

**Why.** Established, and identical to its previous sighting: the file held both the probe and the
work, and `git checkout` does not distinguish them.

**Cost.** About five minutes to rewrite, and only that much because the test bodies were still in
this session's transcript. A compaction away it would have been the whole increment again.

**Prevent by.** This is the second time it has been written up with the same one-line fix, which is
the argument for putting it somewhere an implementer reads rather than in two retrospectives:
**never `git checkout <file>` to undo instrumentation — `git stash -u` instead, which is
recoverable.** It belongs in `.claude/cerebro-traps.md`, where a fact the fleet has already paid for
twice is meant to live.

**Seen before.** `ah-1wcw.6` — same command, same cause, three increments lost rather than six tests.
