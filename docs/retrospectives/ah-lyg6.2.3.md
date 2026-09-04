# ah-lyg6.2.3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-04
- **PR:** #957

## Nothing in this repository catches a conditional React hook

**What happened.** Answering the first review round I added `const [at, setAt] = useState(...)` to
`StudySchedule` *below* its `if (turns.length === 0) return ...` guard. `scheduleTurns(null)` is
empty, so loading or clearing a report with the planner open would have changed the component's
hook count and React would have thrown "Rendered more hooks than during the previous render",
killing the dialog. `pnpm run check:fast` was green, the 17 unit tests were green, and the twelve
smoke cases were green. Only the next review round found it.

**Why.** Established. Two nets are absent at once. `eslint-plugin-react-hooks` is in
`package.json:40` and is **not registered in `eslint.config.mjs`** — `grep -n react-hooks
eslint.config.mjs package.json` matches the manifest and nothing else — so the rule that exists
precisely for this never runs. And `packages/shared` has no jsdom by decision (ah-nass), so no
test in that package can re-render a live instance, which is the only way React's hook-count
invariant fires; two `renderToStaticMarkup` calls both pass against the broken code. My first
attempt at a regression test made exactly that mistake, and its comment claimed cover it did not
have — the round after caught that too.

**Cost.** Two extra review rounds and two pushes, about twenty minutes. Cheap here only because
the reviewer read the whole function rather than the hunk; unreviewed, this would have shipped as
a dialog that dies when a report arrives.

**Prevent by.** Registering `eslint-plugin-react-hooks` in `eslint.config.mjs`. It is already a
dependency, so this is a plugin entry and its recommended rules, and it turns a class that
currently has no net at all into a lint failure. That is a change to the project's gate rather
than to a planned bead, so it is the navigator's to make — this entry is the evidence for it.
Until then, the guard is structural: `StudySchedule` now has no early return above any hook, and
says so in a comment, which is the only defence available inside a bead.

**Seen before.** None found — `grep -rl "react-hooks\|conditional hook\|Rendered more hooks"
docs/retrospectives/` matches nothing. ah-nass records the jsdom decision that is half of the
cause, but not this consequence of it.
