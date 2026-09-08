# ah-i33f — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-09
- **PR:** #1082

## `bd create -p 4` reported P4 and stored P2, with no `--parent` involved

**What happened.** The plan's *Out of scope* section required a follow-up bead for the `SAIL N junk`
divergence, and gave the command verbatim. I ran it as written:

```
bd create -p 4 --type bug --title "The preview reads a SAIL with unreadable directions as a bare SAIL" --description "..."
```

bd printed `✓ Created issue: ah-twsa — … Priority: P4`. The bead was stored at **P2** —
`bd show ah-twsa --json` read `"priority": 2`, which is bd's own default. I reported "filed at P4"
on the PR on the strength of the printed line, and the cold review round caught it as its first
finding. Fixed with `bd update ah-twsa -p 4 && bd dolt push`.

**Why.** Not established. `docs/retrospectives/ah-9o0c.1.md` recorded the same symptom four days
earlier — printed P4, stored P1 — and concluded that `bd create --parent` applies the parent's
priority after parsing `-p`. **This invocation had no `--parent`**, and the stored value was bd's
plain default rather than any inherited one, so that explanation does not cover this case and the
defect is wider than one flag combination: `-p` was ignored outright while the confirmation line
echoed it back.

**Cost.** One review finding and one `bd update`, perhaps five minutes. The real cost is the
reporting: without the review round, a bead the navigator ranks would have sat at P2 claiming to be
unranked, and the PR body would have said so.

**Prevent by.** Never trust bd's `Created issue: … Priority:` line. Any session filing a bead at a
required priority should read it back — `bd show <id> --json | jq .priority` — before reporting the
priority anywhere. `beads-workflow`'s bead-creation section is where that read-back belongs, since
every role in this fleet creates beads and the root `CLAUDE.md` makes P4 mandatory for all of them.
Two sightings with different stored values suggest the fix is in bd rather than in a caller's
discipline, which is the navigator's to weigh.

**Seen before.** `ah-9o0c.1` — same printed-versus-stored mismatch, different stored value, and a
diagnosis this sighting contradicts.
