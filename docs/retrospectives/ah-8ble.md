# ah-8ble — retrospective

## A sibling bead built the same model field while this PR was in CI

**What happened.** ah-8ble (Gates badge) and ah-r5fg (Region pane gate) were filed together by
Cerebro, each naming the other. Both needed the report's `There is a Gate here (Gate N).` line on
`ReportRegion`, and neither had a dependency on the other. This bugfix added `gate: Option<RegionGate>`
(the number) with parser, merge and export changes. Minutes before it would have merged, ah-r5fg
merged `gate: Option<String>` (the sentence verbatim) with its own parser, merge and export. The PR
went `CONFLICTING`, and most of it duplicated main. Dropping the now-redundant commits with
`git reset --hard origin/main` on the bead's own branch was refused twice by the auto-mode
classifier as irreversible local destruction, so it took a navigator question before the branch
could be rebuilt as the one-line badge fix.

**Why.** Two beads filed as a pair named the same missing fact, the report line the reader did not
parse, but only as prose in each description ("filed alongside"). Nothing in the bead graph ordered
them. The bugfix queue (`scripts/bugfix-candidates`) and the producer queue picked them up in parallel.

**Cost.** About forty minutes: a full first implementation and review round thrown away, a second
review, a CI run on a head that could never merge, and a blocking question to the navigator.

**Prevent by.** When Cerebro or `write-bead` files two beads together whose descriptions both name
the same missing parse or model field, `bd dep add` the consumer (here the badge) on the bead that
owns the field (here the pane), so `bugfix-candidates` holds it back until the field is on main.

**Seen before.** The same shape, two open beads on one function with no edge between them, is in
`docs/retrospectives/ah-fvzu.md` and `docs/retrospectives/ah-64wm.md`. Those were planned beads, and
the prevention there was put at `plan-bead`'s scoping step. This one went through the bugfix queue,
which has no planning step, so the edge has to be added at filing.
