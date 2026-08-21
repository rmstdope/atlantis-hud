# ah-qled.9 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-21
- **PR:** rmstdope/cerebro#68 (the change), atlantis-hud#TBD (the pin bump)

## A bead whose work is entirely inside the cerebro submodule has nowhere the skill puts its worktree

**What happened.** `bd heartbeat ah-qled.9`, run from the branch worktree at the end of the first
increment, failed with `no beads database found`. The worktree was a worktree of the *cerebro*
repository (`git worktree add` from `.claude/cerebro`), which I put at `~/repos/cerebro-ah-qled.9` —
outside atlantis-hud entirely, so `bd`'s walk up from `default-directory` never reached `.beads/`.
Every later `bd` call in the run needed an explicit `bd -C /Users/henrikku/repos/atlantis-hud`.

**Why.** `implement-bead`'s *Workspace* section is written for a bead whose diff is in atlantis-hud:
it names `scripts/prepare-worktree`, requires the tree to live under `.cerebro/worktrees/`, and gives
the reason — `bd` and cargo walk up, so a tree outside the repository "silently gets its own empty
bead database". A cerebro-only bead cannot use that path at all. `prepare-worktree` makes an
atlantis-hud worktree, and a worktree of the submodule's own repository placed under
`.cerebro/worktrees/` would sit inside atlantis-hud's tree while belonging to a different repository.
So the rule's *reason* applies to the cerebro worktree while its *instruction* does not, and nothing
says where such a tree should go instead.

**Cost.** Small — one failed heartbeat and about two minutes to diagnose — but it recurs on every
cerebro bead, and the failure mode if it goes unnoticed is worse than the one I hit: a `bd` command
that finds *an empty database* rather than erroring is exactly what the existing rule warns about,
and a heartbeat silently lost against an empty database looks like an abandoned claim.

**Prevent by.** `implement-bead`'s *Workspace* section saying explicitly where a **cerebro-repository**
worktree goes and that every `bd` call from inside it must carry `-C <atlantis-hud root>`. A one-line
`prepare-cerebro-worktree` alongside `prepare-worktree`, or a sentence naming a fixed location and
the `-C`, would settle it; picking a directory per session, as I did, is how the two halves of a
two-PR bead end up in different places on different runs.

**Seen before.** None found. `ah-4ao.md` and `ah-gdp.md` are the same *family* — a submodule step
nobody owns — but both are about the submodule inside an atlantis-hud worktree, not about a worktree
of the submodule's own repository.
