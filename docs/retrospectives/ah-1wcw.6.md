# ah-1wcw.6 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-23
- **PR:** #566

## main was red when I claimed, and no one had noticed

**What happened.** With my bead built and `check:fast` green, CI failed on
`smoke (web, 2, 2)`: `resting on a unit row summarises it`
(`tests/smoke/workspace.spec.ts:1240`). It reproduced locally, and it reproduced on
`origin/main` unchanged, so it was nothing my diff had done. Bisecting two commits by hand
(`git checkout --detach <sha>` then the single spec) put it on 1816c25 — `ah-1wcw.1`, merged
about half an hour earlier, whose own PR CI had gone green. The navigator chose to have me fix it
inside this bead's PR, so `ah-1wcw.6` also carries a one-line fix to `UnitTableDock`.

**Why.** Established. `ah-1wcw.1` threaded `getSilver` into the units table. The memo that builds
the sort maps returned `new Map()` when the table is not sorting on that column, so a fresh array
came out of the `visible` memo whenever `getSilver` changed identity — which is every validation,
every 300ms of typing. The effect keyed on `[visible]` exists to cancel a hover when the rows
rearrange, so it fired on nothing at all and cleared the hover exactly when the 300ms tooltip delay
was due. The tooltip could never open.

**Cost.** About an hour: one red CI cycle, two local single-spec runs to bisect, one full local
smoke run, one more CI cycle. Plus a question to the navigator, since fixing another bead's
regression is outside a planned bead's scope.

**Prevent by.** Two specific things.

1. **A green PR shard is not a green merge.** `ah-1wcw.1`'s CI passed and main went red on the
   same code — its four smoke shards split the suite differently from the run after the squash.
   Worth `implement-bead` saying that a red main is a possible finding for *any* implementer, and
   that the first move on a CI failure in a file the bead never touched is
   `git checkout --detach origin/main` and run that one spec — three minutes, and it settles blame
   before any debugging starts.
2. **A returned-fresh empty collection is a re-render trigger.** In `packages/shared`, a `useMemo`
   whose early-out builds a new empty `Map`/`Set`/array defeats every memo downstream of it. Hoist
   the empty to module scope. Grep-able shape: `return new Map` / `return []` inside a `useMemo`.

**Seen before.** `docs/retrospectives/ah-1wcw.1.md` is the same bead family and the same
implementer, but a different finding; nothing in the directory describes a regression reaching main
green.
