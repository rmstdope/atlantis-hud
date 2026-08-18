# ah-dwk6 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-19
- **PR:** #433

## A new default-on check broke thirty-odd fixtures the plan did not name, in two suites

**What happened.** Every increment the plan named was built and green in order. Turning the check
on then broke, in three separate waves:

1. **26 `orders::semantics` unit tests and 2 in `lib.rs`**, the moment `check_idle_units` was wired
   in. Almost every fixture in that module stands up a unit and gives it only the one order the
   check under test is about — a lone `GIVE`, a `BUY`, a bare block — so the new check is right
   about nearly all of them.
2. **4 smoke specs in `tests/smoke/shortcuts.spec.ts` and, on the next cycle, 5 in
   `tests/smoke/workspace.spec.ts`** — F8's walk stopping at a new finding, and exact
   problem/warning counts on the committed turn-71 fixture.

The plan's *Test plan* named exactly one file as needing updating for this reason
(`validate_real_orders.rs`, three assertions) and was precise about it, including the two units it
would newly warn about. It did not extend that reasoning to the module's own fixtures or to
`tests/smoke/`.

**Why.** A check with no exemptions and on by default fires on every under-specified fixture in the
repository, and `check:fast` runs neither browser suite by design, so the smoke half was invisible
until the PR opened. Both are known and both are documented; what was missing was anyone joining
them to *this* bead before it was built.

**Cost.** Three CI cycles (~7 minutes each) plus about 25 minutes of local smoke runs. No hand-back:
every fix was mechanical and followed a pattern the files already had — `check_ignoring_transfer_targets`
and `check_ignoring_empty_builds` in the Rust suite, `warnAboutUnguardedHexes` in the smoke suite —
so the fix was a `check` helper that disables the code, a new `check_idle` for the check's own
fixtures, and a new `silenceIdleUnits` smoke helper.

**Prevent by.** A plan for a **default-on check with no exemptions** should say so in one line under
*Known traps* and require the implementer to run, before the first increment:

```
rg -c 'unit \d+\\n"' crates/core/src/orders/semantics.rs   # how many fixtures could newly fire
pnpm exec playwright test --project=web                    # ~3.5 min, catches the smoke half
```

That is the measurement the plan already made against the *real turn* (2 of 27 units) applied to the
*test corpus*, which is where the cost actually lands. The plan's own §"Measured, not guessed" shows
the habit exists; it was simply pointed at the fixture turn and not at the suites.

**Seen before.** ah-djq — same class, same two smoke jobs, same "check:fast does not run the browser
suites" root, for `give-target-not-here`. This is the second sighting of a new default-on advisory
check breaking exact-count smoke specs, and the first where the module's own unit fixtures broke too.
