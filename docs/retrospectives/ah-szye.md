# ah-szye — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-04
- **PR:** #918

## The documented regenerate command silently wrote to the shared main checkout again

**What happened.** `cargo test -p atlantis-hud-core --lib export_bindings_`, run from
`.cerebro/worktrees/ah-szye` exactly as the bead's *Validation* section names it, reported 89
passing tests and left `packages/core-client/src/generated/BuyAllShown.ts` in the worktree
untouched. `pnpm run check:fast` then failed its `generated` leg. Running it a second time changed
nothing; `git stash push` of the file and a re-run did not recreate it. The bindings had gone to
`/Users/henrikku/repos/atlantis-hud/packages/core-client/src/generated/` — the **shared main
checkout** — which `git -C <repo> status --short` showed dirty. Only
`TS_RS_EXPORT_DIR=$PWD/packages/core-client/src/generated cargo test ...` wrote into the worktree.

**Why.** Established, and already established once: `.cargo/config.toml` sets `TS_RS_EXPORT_DIR`
under `[env]` without `force = true` (deliberately — `scripts/checkGenerated.ts` overrides it), so
Cargo yields to whatever the caller exports, and this session's environment carried it as an
absolute path anchored to the main checkout.

**Cost.** About ten minutes, and a dirty shared checkout restored with `git checkout --`. Less than
the fifteen `ah-omn7` cost, because that retrospective existed to be found — but it was found *after*
the failure, not before it.

**Prevent by.** `ah-omn7`'s retrospective records the same cause and the same fix, and it did not
stop the second occurrence, because nothing a plan or a skill says is read at the moment the command
is typed. The durable fix is in the repository rather than in prose: either `scripts/prepare-worktree`
should unset or re-anchor `TS_RS_EXPORT_DIR` for the tree it creates, or the `generated` gate leg
should say "the bindings were written outside this worktree" instead of only "they differ". Both are
the navigator's to decide; this is recorded, not fixed.

**Seen before.** `ah-omn7` — same command, same cause, same shared checkout, one bead earlier and the
same implementer name.

## A file-wide string replace clobbered two unrelated test fixtures

**What happened.** Two new test fixtures needed their market line named `"swords"` rather than
`"sword"` for the pluraliser. I applied the rename with a file-wide `str.replace`, saw it hit 12
sites instead of 2, and reverted it with the inverse file-wide replace — which rewrote two
*pre-existing* fixtures that had legitimately said `"swords"` all along
(`a_mage_may_still_buy_equipment`, `a_buy_of_goods_is_not_a_recruit`). Both still passed, so no gate
caught it. The review sub-agent found it, reverted both locally to check, and reported that they pass
unchanged either way.

**Why.** Established. An inverse blanket replace is not the inverse of a blanket replace: it cannot
tell the sites it created from the sites that were already there. The same session had earlier swept
42 `false,` arguments to `SharedMarket::Adds(0)` with `sed` and verified the result only afterwards,
which happened to be correct.

**Cost.** One review round's worth of the reviewer's attention, and a second commit. No production
code was affected.

**Prevent by.** Scope a mechanical rename to the function bodies it belongs to — locate the `fn`, cut
the body, replace inside it — rather than over the file, and assert the expected occurrence count
*before* writing. `implement-bead`'s *Traps* section is where this would sit, if the navigator judges
it general enough to belong there.

**Seen before.** None found — `grep -rl "sed\|replace" docs/retrospectives/` returns nothing on this
symptom.
