# ah-ywj7 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-23
- **PR:** rmstdope/cerebro#95, and the pointer bump here

## The plan's own `jq` snippet was inert, and would have disabled the bead's headline remedy silently

**What happened.** The plan specified the epic-ownership lookup — the whole point of the bead — as

```
bd show <id> --json | jq -r '… (.dependencies // [])[] | select(.type=="parent-child") | .depends_on_id'
```

Run against the live database this prints nothing, for every bead. The field is `dependency_type`,
not `type`, and the dependency entry *is* the parent bead embedded whole, so the parent's id is
`.id`; there is no `depends_on_id` field at all. The plan's next line reads *"nothing printed means
the candidate has no parent"* — so a planner following it concludes every candidate is parentless,
never reads a `planner:` label, and the family-ownership rule never fires once. It fails as an empty
answer, which is indistinguishable from the correct answer for a bead that genuinely has no parent.

I copied it into the skill as written. An adversarial review found it; I had not run it.

**Why.** Established. The plan copied the shape from a pre-existing filter in the same file
(`skills/plan-bead/SKILL.md`'s P4 triage query), which has the same wrong field name *and* pipes
`bd list`, whose JSON carries no `dependencies` key at all — only `dependency_count`. That filter's
"not somebody's child" exclusion has therefore never excluded anything either. Filed as **ah-21dq**;
not fixed here, since this bead's plan puts the triage split out of scope and the fix needs a
decision about what a per-bead `bd show` costs over a whole backlog.

**Cost.** Caught before merge, so no wasted CI and no wrong behaviour shipped — about forty minutes
of rework across four documents, and it would have cost far more later: the bead would have merged,
been verified against its tests (which do not touch this path), and the collision it exists to
prevent would have gone on happening with everyone believing it was fixed.

**Prevent by.** `plan-bead` should require that **any `bd`/`jq` command a plan hands to an
implementer is run against the live database during planning, with its output pasted into the plan**
— not merely written. This is cheap for the planner, who is already at a terminal with `bd` on it,
and it is the only check that separates a snippet that works from one that is merely plausible. The
Validation section already asks for acceptance commands; the gap is that snippets in *Files to
change* are not held to the same standard. An implementer's own guard, worth stating in
`implement-bead`: **a filter whose failure mode is an empty result must be proved non-empty on a
case you know should match**, before it is trusted or copied.

**Seen before.** `ah-j1xd` — same family, different mechanism: a plan carrying figures that were
correct only against a state that did not exist yet, likewise not checkable as written. Two now.

## A prefix match and a membership test disagreed about what counts as a label

**What happened.** The change reads one label two ways: in elisp (`cerebro--holding-label-p`) and in
the skill's `jq` filters. I wrote the elisp to require the `:` separator — so `planning-notes` is not
a hold — and the `jq` as a bare `startswith("planning")`, which says it is. Both were green: the ERT
suite tests only the elisp, and the `jq` has no test at all, being a documented command.

**Why.** Established. The two readers were written twenty minutes apart, in different files, for
different audiences, and nothing in the repository can compare them. The near-miss case only exists
because I tightened the elisp after review; I did not go back to the `jq`.

**Cost.** Small — found by the same read-through, one commit. Its interest is the shape rather than
the size: a rule implemented in code and in prose has two implementations and one test suite.

**Prevent by.** When a rule is read by both code and a documented command, write the rule out in one
sentence and grep for every place that implements it before committing — here,
`grep -rn 'startswith("planning")\|holding-label' .` across the repository. There is no test that can
do this, which is exactly why it needs a step.

**Seen before.** None found.
