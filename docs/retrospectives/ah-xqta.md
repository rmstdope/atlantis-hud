# ah-xqta — a lint error in a smoke spec passed the fast gate and CI

**What happened.** Moving `freezeClock` out of `tests/smoke/study-planner.spec.ts` left that file
importing `type Page` for nothing. `pnpm run check:fast` reported `lint PASS`, and CI went green on
that head. The cold-read reviewer caught it by running `npx eslint` on the file. Running
`npx eslint tests/smoke/` then turned up two more unused imports in
`tests/smoke/completion-popup.spec.ts`, already on main.

**Why.** Established. `pnpm run lint` is `pnpm -r run lint`, which lints each workspace package and
nothing else. `tests/smoke/` belongs to no package, so neither the fast gate nor CI ever lints it.

**Cost.** One review round and one extra push with its CI run (about 10 minutes). Errors in the
smoke specs pile up unnoticed until somebody happens to lint them by hand.

**Prevent by.** Root `package.json` `lint` script: lint `tests/` too (for example, append
`&& eslint tests`), so `check:fast` and CI's lint step cover the smoke specs.

**Seen before.** Nothing in `docs/retrospectives/` mentions the smoke specs being unlinted.
