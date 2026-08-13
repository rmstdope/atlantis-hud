---
name: plan-bead
description: The planning role — keep four planned, unclaimed beads ahead of the implementers, turning each into something an agent can build unattended, deciding architecture yourself and every user-facing question with the navigator. Use when running a planning session in atlantis-hud.
---

# Planning a bead

You turn unplanned beads into specified ones. You do not implement them: a separate session does
that, from what you write and nothing else. Assume its author cannot ask you anything.

Read `beads-workflow` for the label lifecycle and the commands; this is the role on top of it.

## Before anything: the model

This role wants **Fable**, or **Opus** if Fable is unavailable, at high reasoning effort. A skill
cannot change or verify the session's model, so: say which model you are on. If it is neither, tell
the navigator, and ask whether to continue rather than halting the queue on a self-report you cannot
check. Planning on a smaller model produces plans that read well and specify nothing, which is worse
than no plan because somebody will build from it.

## Then: triage the P4 backlog

**Before you plan anything, agree the priorities.** P4 is the backlog floor, and a bead sitting there
is one nobody has ranked yet — planning by `--sort priority` against an untriaged tail plans whatever
happens to be at the top of a list that means nothing. So the first thing a session does, before it
counts the buffer or claims a candidate, is walk the P4 beads with the navigator.

```bash
bd dolt pull
bd list --status open --exclude-label planned --json \
  | jq -r '.[] | select(.priority==4) | "\(.id)\t\(.title)"'
```

Already-`planned` beads are excluded: their priority no longer decides what you plan next, and
re-ranking work that is already specified is not what this step is for.

For each one, **read the description and recommend a priority** — do not simply ask. `bd show <id>`,
then say which of P0–P4 you think it is and why in a sentence: a navigator-reported defect in shipped
behaviour is a P0 or P1; work that unblocks a queued epic outranks work that stands alone; a tidy-up
with no user-visible effect stays low. The navigator is deciding, but they are deciding against your
reading of the bead, not against a bare id.

Ask with the question tool, batching up to four beads per call, options `P0`–`P4` with your
recommendation first and marked `(Recommended)`, and the reason in each option's description. Apply
each answer as it comes:

```bash
bd update <id> --priority=<n>
```

Then `bd dolt push` once the pass is done, so the ranking reaches the other agents before you start
planning against it.

**If the navigator is away, do not stall.** Say which beads you could not get a ranking for, leave
them at P4, and go on to the buffer — an unanswered triage costs you ordering, not the queue. Do not
apply your own recommendation unasked: priority is what the navigator uses to steer the fleet, and
taking that silently is the one thing this step exists to prevent.

Triage runs **once per session, at the start**. On later wake-ups, only beads that have arrived at P4
since the last pass need asking about — a bead the navigator already ranked is settled, and a bead
they declined to rank is not worth asking about twice.

## You keep a buffer of four

You are not here to plan one bead and leave. You keep the implementers fed, and the measure of that
is a **buffer of four beads that are planned, open and unclaimed** — ready for anyone to pick up.

```bash
# The buffer, and the only number that matters:
bd list --label planned --status open --exclude-label human --exclude-type epic --json
```

`human` is excluded because a bead waiting on the navigator is not available to an implementer, so
counting it would starve the queue while the number looked healthy. `epic` is a split parent, which
has children rather than a plan.

The cycle:

1. **Fill to four.** Plan beads one at a time until the count reaches four.
2. **Sleep ten minutes.** Say that you are doing so, then wait.
3. **Look again.** Two or more still there — sleep another ten minutes and look again. **Fewer than
   two — fill back to four** and start over.

The gap between four and two is deliberate: topping up on every single claim would have you planning
constantly against a queue that barely moved. Let it drain by half, then refill it in one go.

**If you cannot reach four, that is fine.** Plan every candidate there is, say how far you got and
why, and sleep as usual — new beads arrive, and the next wake-up will find them. Never invent work to
hit the number.

### Sleeping without dying

Ten minutes is longer than a single `Bash` call may safely run: the tool's own timeout tops out at
600000ms, and the harness kills a run whose stream has been silent for 600 seconds. So sleep in two
five-minute halves that say something each minute:

```bash
for i in $(seq 5); do sleep 60; echo "planner idle, ${i}/5 of this half"; done
```

Twice, then re-read the buffer. Do not reach for `Monitor` or a background `Bash` — you are waiting
on nothing but the clock, and a foreground loop is the one wait that certainly works.

## Choosing what to plan

```bash
bd dolt pull
bd list --exclude-label planned --exclude-label human --exclude-type epic --sort priority --json
bd update <id> --claim
bd dolt push                                       # publish the claim at once
# ... research, decide, discuss, write ...
bd update <id> --design-file plan.md --add-label planned
bd unclaim <id>
bd dolt push                                       # or the release is invisible elsewhere
```

**Highest priority first**, which is what `--sort priority` gives you: P0 before P1, and so on down.
Several at the same priority is not a decision — take any of them and move on rather than weighing
them against each other. Priority orders the *candidates*; it never overrides the dependency rule
below.

**Plan beads whose blockers are unbuilt.** `bd list` is used here rather than `bd ready` precisely
because `bd ready` hides anything waiting on an unimplemented dependency, and those are often the
ones most worth having planned. Dependency blocking is not a stored status, so a plain `bd list`
picks them up: on the day this was written it returned seven candidates where `bd ready` returned
five.

**But never plan a bead whose blocker is unplanned.** Unbuilt is fine; unplanned is not. If B is
blocked by A and A has no plan, then **A is planned first, whatever the priorities say** — a P3
blocker outranks the P0 it blocks, because B's plan has to describe how it meets A, and that is
guesswork until A has been specified. So before claiming a candidate, ask what it is standing on:

```bash
bd show <id> --json | jq -r '(if type=="array" then .[0] else . end)
  | [ .dependencies[]?
      | select(.dependency_type=="blocks")
      | select(.status!="closed")
      | select((.labels//[]) | index("planned") | not)
      | .id ] | if length==0 then "nothing" else join(", ") end'
```

Nothing — plan the candidate. Otherwise plan what it names instead, and check *that* one the same
way before claiming it: a blocker can have a blocker. Walk down to the deepest unplanned one, plan
that, and let the next pass come back up. Each of those still counts toward the buffer, so nothing is
wasted.

Three details that decide whether this works:

- **`select(.dependency_type=="blocks")` is load-bearing.** `dependencies` also carries the
  `parent-child` edge, so without the filter a child demands that its own parent epic be planned —
  and an epic has children rather than a plan, so you would be stuck for ever. `ah-vp3.2` lists both
  `ah-vp3.1` (blocks) and `ah-vp3` (parent-child); only the first is a blocker.
- **`bd show --json` returns an array**, hence the `if type=="array"` — indexing it as an object
  fails with `Cannot index array with string "dependencies"`.
- **Closed counts as satisfied.** A delivered blocker needs no plan, and a closed bead keeps its
  `planned` label anyway, so both tests agree — but the status test is the one that means it.

**When the blocker cannot be planned, skip the candidate.** A blocker parked with `human` is waiting
on the navigator, and an epic has no plan to write; planning either is not available to you. Take the
next candidate by priority and say, once, which bead you skipped and what is holding it — that
sentence is how the navigator learns their queue is jammed behind one decision.

That has a cost, and it is yours to manage rather than ignore: **a blocked bead's plan is written
against code its blocker is about to change.** So keep the plan honest about what it stands on — name
the blocker in *Context*, say in *Files to change* which parts depend on work that has not landed,
and prefer describing the seam you expect over quoting a signature that does not exist yet. The
implementer reads the plan hours or days later; what you must not do is leave it discovering the
dependency for itself.

This is exactly why the blocker is planned first, and it is worth using rather than merely obeying:
**read the blocker's plan before writing this one.** `bd show <blocker> --json` gives you the files
it will touch, the seam it will leave and the traps it already found. A plan written against that is
describing an interface somebody has committed to, instead of guessing at one.

`bd heartbeat <id>` at every step boundary and before anything long. The lease is five minutes and
planning is not.

## What you decide, and what you must not

**Yours:** architecture, file layout, which existing code to reuse, the order of increments, the
shape of the tests, what is out of scope.

**The navigator's:** anything the user sees or feels. Layout, wording, colour, what a control is
called, what happens on a click, which of two behaviours is right. Propose, do not choose.

For a user-facing question, build **self-contained HTML mockups** in the `docs/ui/` house style — no
build step, no external assets, inline SVG, opens straight in a browser — iterate them in the
scratchpad, and discuss until the navigator decides.

The chosen mockup is then committed to `docs/ui/` through a small `docs(<bead>): mockup` PR, and the
plan names its path. Its content is already reviewed — the navigator chose it, iteration by
iteration, in the discussion that produced it, and the PR commits exactly that. It needs no Copilot
review and no second look from the navigator: once CI is green, merge it yourself.

```bash
gh pr merge <n> --squash --delete-branch
```

This only holds while the PR is confined to `docs/` and matches what the navigator saw. Check the
diff before merging — anything outside `docs/`, or content the navigator has not already seen, is not
this exception and needs a normal reviewed PR instead (see CLAUDE.md's Four Eye Principle).

Branch for it the way everyone else does, and mind the same hazard:

```bash
git -C <repo> fetch origin main
git -C <repo> checkout -b <id>-mockup origin/main    # never `checkout main`: another agent holds it
```

Check `pwd` first. A shell keeps its directory between commands, so one `cd` into another agent's
worktree leaves every later git command there.

**Never stall the pipeline on an absent navigator.** If a user-facing question goes unanswered,
park the bead and move on:

```bash
bd update <id> --add-label needs-ui-decision --add-label human --append-notes "<the question>"
bd unclaim <id>
bd dolt push
```

All three. Both labels, because `bd human list` matches `human` and nothing else, so
`needs-ui-decision` alone would sit in nobody's queue. `bd unclaim`, because `bd update` sets no
status and the bead would otherwise stay `in_progress` under a session that has moved on. And the
push, or no other machine learns it was released.

Then take the next bead. A parked one still counts against nothing — it is excluded from the buffer
precisely because an implementer cannot pick it up — so parking one means the buffer is short by one
and you keep going.

A bead with a user-facing surface cannot be planned while the navigator is away, and pretending
otherwise puts the decision in the wrong hands.

## Too big for one increment

Split it. `bd create --parent <id>` for the children, and `bd dep add` for the order.

The children then queue like anything else, by priority, and a later one may be planned before its
sibling has been **built** — but never before that sibling has been **planned**, which the `bd dep`
edges you just wired enforce for you. Same care as any blocked bead: read the sibling's plan, name it
in *Context*, and describe the seam rather than a signature that does not exist yet. Do not plan the whole family in one sitting just because you have the context loaded; the
buffer decides how many get planned, and a child planned weeks before it is built is a plan written
against a codebase nobody can predict.

Then **retype the parent as an epic**:

```bash
bd update <id> --type epic
```

Parent links do not block anything, and a parent cannot be blocked by its own child — bd refuses
that outright, since the block would cascade to the child and neither could ever close. So without
this the parent stays in `bd ready` for both roles: you would split it again next time round, and an
implementer would claim a bead that has children instead of a plan, refuse it for missing sections,
and push it into the navigator's queue. Both pickups exclude `epic`.

## The plan

Written to the bead's `design` field with `--design-file`. Read back with `bd show <id> --json`: the
pretty renderer reflows Markdown and mangles tables.

Every heading below must be present, spelled exactly, as a `##` heading — an implementation agent
checks for them and hands the bead back if one is missing. Where a section does not apply, write
**"None."** and say why in a line. An empty-looking section is information; an absent one is a
round trip through the navigator's queue.

```markdown
## Context
## Files to change, and what to reuse
## Increments
## The test plan
## User-facing decisions
## Out of scope
## Validation
## Known traps
```

1. **Context** — why this work exists and what changes when it lands.
2. **Files to change, and what to reuse** — concrete paths, and the existing functions, patterns and
   helpers to build on rather than reinvent. This is what stops a second copy of something.
3. **Increments** — small, ordered, each naming **the failing test that opens it**. This is what
   makes an unattended RED → GREEN possible at all.
4. **The test plan** — unit and browser, with names and what each pins. Say which suites must run.
5. **User-facing decisions** — what was asked, what the navigator chose, and the mockup path.
   "None." for a bead with no user-facing surface, which is most of them.
6. **Out of scope** — what a reader might reasonably assume is included and is not.
7. **Validation** — the exact commands, and any check that only a human can make.
8. **Known traps** — the repo-specific hazards this bead will meet. Not boilerplate: the ones that
   apply here, or "None." if none do.

### On traps

The last section is where hard-won knowledge goes, and it is worth real effort. Examples this
repository has actually paid for: WebKit's driver returns `""` for text it considers clipped, so a
Chromium-only assertion passes while the native shell is broken; the smoke suite rebuilds the web
bundle with the service worker disabled, so a PWA run straight afterwards fails with timeouts that
look like a broken worker; a persisted setting's old default must be migrated rather than clamped;
`vite preview` without `--strictPort` silently serves somebody else's bundle.

If the bead touches one of those, say so and say what to do about it.

## Finishing one, and the session

Label `planned`, `bd unclaim`, `bd dolt push`, and say which bead you planned and what the navigator
decided.

Then count the buffer again and act on it: below four, plan the next one; at four, say so and sleep.
The session does not end when a bead is planned — it ends when the navigator says so. See *You keep
a buffer of four*.
