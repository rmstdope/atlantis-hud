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

## A column-based read of `gh pr checks` reported pending matrix jobs as green

**What happened.** I waited on CI with
`gh pr checks 1113 | awk '{print $2}' | sort | uniq -c`, which is the status column for an ordinary
job. Four of this repository's jobs are matrix jobs whose names contain spaces and commas —
`smoke (web, 1, 2)` and its three siblings — so `$2` picked up `(web,` rather than the status. The
loop saw `2 (desktop-shell, 2 (web, 7 pass` and no `pending`, called it green, and I went on to
merge. `gh pr merge` refused with "the base branch policy prohibits the merge", and the raw
`gh pr checks 1113 | grep smoke` showed all four matrix jobs still `pending`. Nothing was merged on
a bad read, but only because the branch policy caught it.

**Why.** `gh pr checks` is tab-separated, and the fields are name, status, elapsed, url. `awk`'s
default splitting is on whitespace, so any job name containing a space shifts every later field.

**Cost.** One refused merge and about three minutes, plus the risk — a repository whose policy did
not require the checks would have merged on four unfinished jobs.

**Prevent by.** `implement-bead`'s *Waiting, without ending your run* gives
`until <the condition>` without saying how to read a check's status; it should name the
tab-safe form, `gh pr checks <n> --json name,state -q '.[].state'`, or `awk -F'\t' '{print $2}'`.
A whitespace-split `$2` is wrong on any repository with a matrix job.

**Seen before.** `ah-1zca.1` — the same trap, the same four `smoke` jobs, and the same false
all-green, recorded as "Parsing `gh pr checks` by column reported a false all-green while four jobs
were still running". That retrospective also records a second way to get it wrong: a running job's
`conclusion` in `statusCheckRollup` is the **empty string**, not `null`, so `.conclusion // .status`
keeps the empty string. I hit both in this pass without having read it. **That makes this the second
recorded sighting and the strongest evidence the fleet has that the wait loop in `implement-bead`
needs the tab-safe command written into it rather than left to each implementer.**
