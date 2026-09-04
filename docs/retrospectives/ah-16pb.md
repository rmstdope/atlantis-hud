# ah-16pb — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-04
- **PR:** #925

## The bead was planned against the wrong half of its own root cause, which a previous retrospective had already recorded

**What happened.** ah-16pb was filed and planned entirely around cargo's cwd anchoring: `relative = true`
makes cargo resolve `TS_RS_EXPORT_DIR` against the config it finds walking up from the *working
directory*, so a run whose cwd is the main checkout and whose `--manifest-path` is a worktree exports
into the main checkout. That mechanism is real, and the fix for it is right. It is not what leaked on
2026-09-04. The new guard failed on its first run *from inside my own worktree*, cwd correct:

    $ cargo test -p atlantis-hud-core --lib export_dir
      export directory: /Users/henrikku/repos/atlantis-hud/packages/core-client/src/generated
      this workspace:   /Users/henrikku/repos/atlantis-hud/.cerebro/worktrees/ah-16pb

    $ env | grep -E 'TS_RS|CARGO_MANIFEST_DIR'
    CARGO_MANIFEST_DIR=/Users/henrikku/repos/atlantis-hud/.claude/cerebro/fleet-view
    TS_RS_EXPORT_DIR=/Users/henrikku/repos/atlantis-hud/packages/core-client/src/generated

The fleet view is itself a cargo process inside the repository, so it picks up the root config's
`[env]` table and exports it to every session it launches. The entry carries no `force = true` on
purpose, so that inherited value beats the config in every worktree — fixed anchor or not. No cwd
mistake is required to reproduce the incident.

**Why.** Established, and this is the third sighting rather than the first.
`docs/retrospectives/ah-omn7.md` — written by the very run whose bindings leaked — already names the
inherited variable as the cause, in its own heading, and already proposes unsetting it. `ah-szye.md`
records the same seam a step earlier. Cerebro then filed ah-16pb from the *artefact* (a dirty file in
the navigator's checkout) rather than from that retrospective, and the plan reasoned from the config
file alone. Nothing reads the retrospectives when a bead is filed or planned, so a cause already
written down was rediscovered twice, at the cost of a whole planning cycle aimed at the wrong
mechanism.

**Cost.** The build itself was cheap. The waste is one bead planned against half its cause, plus a
navigator question mid-review and a follow-up bead (ah-79ca) to do what `ah-omn7.md` had already
recommended nine days of fleet-time earlier.

**Prevent by.** When a bead is filed from an incident, `grep docs/retrospectives/` for the symptom
before writing the description — and again in `plan-bead` before the *Context* section is written.
`implement-bead`'s *The retrospective* already tells the implementer to grep this directory so
*Seen before* is real; the same grep is worth more one step earlier, where it would change what gets
built rather than only what gets recorded. This is a concrete case of the directory doing its job and
nobody opening it.

**Seen before.** ah-omn7 (same cause, recorded in full), ah-szye (same seam, worktree exports),
ah-gdfe (`export_to` resolution against the same variable). The `check:generated` family more broadly:
ah-1wcw.3, ah-moq3.

## The guard's first green run needed the stray variable unset

**What happened.** Every `cargo test`, `pnpm run check:fast` and reproduction command in this session
had to be prefixed with `unset TS_RS_EXPORT_DIR` (or `env -u`), because otherwise the new guard —
correctly — refuses the run.

**Why.** Established: the leak above. It is the guard working, not a defect.

**Cost.** Minutes, and one confusing failure before `env` was read.

**Prevent by.** ah-79ca fixes it at the launcher. Until it lands, an implementer whose bead touches
`crates/core` should expect `export_bindings_stay_inside_this_workspace` to fail and should run with
`env -u TS_RS_EXPORT_DIR`; the failure message says so itself, which is the point of it.

**Seen before.** ah-omn7 (`env -u TS_RS_EXPORT_DIR cargo test ...` is the workaround it recorded).
