# ah-5r9j.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-08
- **PR:** #1065

## An `_`-prefixed *variable* is a lint error here; only an `_`-prefixed *argument* is forgiven

**What happened.** The plan supplied the replacement `withGoals` verbatim, and it opened with
`const { skill: legacySkill, targetLevel: _legacyTargetLevel, ...carried } = plan;` plus the same
shape inside the `map` callback. Typecheck and both test suites passed; `pnpm run check:fast` then
failed its lint leg with two `@typescript-eslint/no-unused-vars` errors on
`packages/browser-core/src/webCoreAdapter.ts`. `eslint.config.mjs:24` configures that rule with
`argsIgnorePattern` and nothing else — no `varsIgnorePattern`, and `ignoreRestSiblings` is not
having the effect the pattern assumes — so a discarded `_`-prefixed *local* is an error while the
identical binding in a *parameter* pattern is fine. That is why
`webCoreAdapter.ts`'s existing `plans.map(({ databasePath: _databasePath, ...plan }) => …)`
survives and the plan's version did not. Fixed by moving both destructures into parameter position:
`withGoals` destructures its own argument, and the `map` callback destructures its.

**Why.** Established: the rule's configuration at `eslint.config.mjs:24` forgives only arguments,
and every existing discard-by-underscore in this repository happens to sit in a parameter pattern,
so the idiom reads as generally safe when it is not.

**Cost.** One extra `check:fast` cycle and a deviation to write up, about ten minutes. It did not
reach CI.

**Prevent by.** A plan that supplies a destructure discarding a field should put it in a parameter
pattern, or say the local form needs `varsIgnorePattern` first — `eslint.config.mjs:24` is the file
that decides it. Equally: `pnpm run check:fast` before the PR is what caught this, and running only
`typecheck` plus the touched suites would not have.

**Seen before.** `docs/retrospectives/ah-2a96.md` — same rule, opposite direction (there the rule
was absent from `tests/` and let an unused binding through). None found for the
argument-versus-variable distinction itself.
