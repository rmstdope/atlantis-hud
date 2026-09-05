# ah-ty3s.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-05
- **PR:** #973

## A review sub-agent's `tsc -b` left compiled `.js` beside the sources, and my next test run silently used them

**What happened.** A `reviewer` sub-agent I spawned ran `pnpm exec tsc -b packages/shared` to check
its finding. That emitted a `.js` and a `.d.ts` beside every source and test file in
`packages/shared/src` — 842 untracked files. I then fixed the defect it had found, ran
`npx vitest run packages/shared/src/diagnosticNav.test.ts`, and got a failure I could not explain:
the code plainly did what the test asked and the test said it did not. Vitest resolves
`import … from "./diagnosticNav"` to `diagnosticNav.js` in preference to `.ts`, so every run after
the sub-agent's build tested the compiled snapshot of the *previous* head. I spent about fifteen
minutes debugging correct code — including a `console.log` that never printed, which was the clue —
before `ls packages/shared/src/diagnosticNav*` showed four files where there should be two.

**Why.** `packages/shared/tsconfig.json` is a build configuration with no `noEmit`, so `tsc -b`
against it does exactly what it says; and a sub-agent works in the parent's worktree, so what it
runs is not sandboxed from the parent's next command.

**Cost.** About fifteen minutes, and it came close to costing much more: had the stale `.js` been
one commit *newer* rather than older, the suite would have been green and I would have pushed a fix
that did nothing.

**Prevent by.** `implement-bead`'s *Getting the review* section should tell the sub-agent, in the
prompt, not to run an emitting build in the parent's worktree — `tsc --noEmit -p <package>` or the
project's own `typecheck` script only. I put that line in every later round's prompt by hand and it
held, but a rule that has to be remembered per spawn is one that will be forgotten. The rule for
the implementer's own commands already exists (ah-lyg6.1.2.2); what is new here is that the
sub-agent can poison the worktree, and that the symptom is a *wrong* test result rather than
committed clutter.

**Seen before.** `ah-lyg6.1.2.2` — same command, same emission, but there it was caught by
`git add -A` sweeping 726 files into a commit. This is the second sighting and the first where the
emitted files changed what a test reported.

## The plan's own smoke assertions could not be made where it put them

**What happened.** Increment 6 asked a `renderToStaticMarkup` test to assert the editor's
`aria-label` and the lines it holds. Neither is observable there: CodeMirror sets the label in an
effect and mounts into an empty div, so the static markup has the pane's hint and an empty
container. I moved both assertions to the smoke walk and left a comment saying why.

**Why.** `.cerebro/traps.md` says never to ask for an effect-level test in `packages/shared`, and
the plan's own *Known traps* repeats it — but the plan then wrote two such assertions anyway, in the
increment where the trap applies most directly.

**Cost.** Small, perhaps ten minutes across two failing runs.

**Prevent by.** When a plan names a `*.test.tsx` in `packages/shared` and quotes an assertion, the
assertion is worth checking against the trap before writing the increment, not after — the trap is
about the *file*, and a plan that names the trap can still ask the file for something it cannot do.

**Seen before.** None found for this shape — `grep -rl renderToStaticMarkup docs/retrospectives/`
matches nothing.
