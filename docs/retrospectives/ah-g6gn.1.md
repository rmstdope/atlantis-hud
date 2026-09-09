# ah-g6gn.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-09
- **PR:** #1113

## The plan was amended after I read it, and I declined a review finding against my stale copy

**What happened.** I read the plan once at the start of the pass with
`bd show ah-g6gn.1 --json > /tmp/wolv-bead.json` and worked from that copy. It specified
`cheapest_path` and `step_into` each taking one more plain `sail_rule: SailRule` argument. That
signature trips `clippy::too_many_arguments` at 8/7, so I recorded a deviation in the PR body and
bundled the two values into a struct I named `Traversal`. The cold review's finding 2 asked for the
plan's named constructor; I declined it, in writing, on the ground that "the plan specified no
struct and no constructor". The next delta round quoted the plan's `design` field back at me: it
specifies `pub(crate) struct Journey { mode, sail_rule }` with `Journey::enforced(mode)`, names all
three call sites, and gives the clippy argument as its own reason for the struct. `grep -c Journey
/tmp/wolv-bead.json` is 0; the live field has fourteen matches. The plan had been amended between my
read and the review, and I never re-read it.

**Why.** The skill says to read the plan with `bd show <id> --json` and says nothing about the plan
changing during a pass — reasonably, since a planner amending a claimed bead is not the ordinary
case. Nothing in the flow re-reads it, and a saved copy gives no sign of being stale.

**Cost.** One wrong answer posted publicly on the PR, one production commit to undo `Traversal` and
re-derive `Journey`, and two extra review rounds — about 20 minutes, plus the reviewer's two rounds.
It also cost a false sentence in the PR body claiming a deviation that no longer existed.

**Prevent by.** `implement-bead`'s *The review loop* should say that a finding which cites the plan
is checked against the plan **as it stands now**, not against the copy read at the start of the pass
— one `bd show <id> --json | grep` before writing a decline that turns on what the plan says. The
same guard belongs in *When the plan is wrong*, beside the existing rule that a helper the plan
cites is read before it is built on: the plan itself is a source that can move under you.

**Seen before.** `ah-cw75` — a plan amended in place whose *Validation* section still described the
behaviour the amendment reversed. Same root: an amended plan and a reader holding an older reading
of it. That one was the planner leaving a stale section behind; this one was the implementer holding
a stale copy.
