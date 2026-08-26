# ah-38qc — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-26
- **PR:** #737 (and rmstdope/cerebro#166)

## The plan's own validation command reads `unset` from the implementer's own worktree

**What happened.** The plan's *Validation* section gives, to be run "from the worktree root":

    .claude/cerebro/scripts/project-conf verification_skill    # prints: atlantis-verification

Run exactly that, from `.cerebro/worktrees/ah-38qc`, after both the declaration and the skill
existed and were committed on the branch, it printed `project-conf: verification_skill unset, and
no default` instead. The tooling test (`scripts/verificationSkill.test.ts`, which parses
`.cerebro/project.conf` directly) was green the whole time, so this looked like a contradiction
between two "gates" for a moment.

**Why.** `.claude/cerebro/scripts/project-conf` resolves the consumer root via
`consumer-root --shared` — deliberately the *main* checkout every worktree shares, not the worktree
the script is invoked from (this is documented behaviour: models.conf and the fleet's own state are
meant to be read the same way from every worktree). Before this bead's branch is merged, the main
checkout's `.cerebro/project.conf` has no `verification_skill` line yet, so the shared lookup
reports it unset — regardless of what the worktree's own copy says.

**Cost.** A few minutes of double-checking the file, the parser, and the script before finding
`consumer-root --shared`'s doc comment; no CI cycle, no rebase.

**Prevent by.** The plan's *Validation* section for a bead that adds a new `project.conf` key
should say the CLI check only reflects reality after merge (or should validate through the tooling
test / a direct `grep` of the worktree's own file instead of through `project-conf`, which is
shared-root by design). This is a fact about `project-conf --shared` generally, not specific to this
key — a future bead's plan asking someone to run `project-conf <new-key>` from their own worktree
before merging will hit the same false negative.

**Seen before.** None found.
