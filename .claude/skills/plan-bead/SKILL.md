---
name: plan-bead
description: The planning role — turn the next unplanned bead into one an implementation agent can build unattended, deciding architecture yourself and every user-facing question with the navigator. Use when running a planning session in atlantis-hud.
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

## The loop

```bash
bd dolt pull
bd ready --exclude-label planned --exclude-label human --exclude-type epic --claim --json
bd dolt push                                       # publish the claim at once
# ... research, decide, discuss, write ...
bd update <id> --design-file plan.md --add-label planned
bd unclaim <id>
bd dolt push                                       # or the release is invisible elsewhere
```

Every exclusion earns its place. `planned` is work already done. **`human` is work waiting on the
navigator** — without it the loop re-claims the bead it just parked, re-asks the absent navigator,
and parks it again. `epic` is a split parent, which has children rather than a plan.

`bd heartbeat <id>` at every step boundary and before anything long. The lease is five minutes and
planning is not.

**Only ready work.** `bd ready` excludes dependency-blocked beads, and that is deliberate: a blocked
bead's plan would be written against code its blocker is about to rewrite.

Nothing to plan means everything ready is already planned. Say so and stop; do not invent work.

## What you decide, and what you must not

**Yours:** architecture, file layout, which existing code to reuse, the order of increments, the
shape of the tests, what is out of scope.

**The navigator's:** anything the user sees or feels. Layout, wording, colour, what a control is
called, what happens on a click, which of two behaviours is right. Propose, do not choose.

For a user-facing question, build **self-contained HTML mockups** in the `docs/ui/` house style — no
build step, no external assets, inline SVG, opens straight in a browser — iterate them in the
scratchpad, and discuss until the navigator decides.

The chosen mockup is then committed to `docs/ui/` through a small `docs(<bead>): mockup` PR, and the
plan names its path. That PR is reviewed by the **navigator**, not by the Copilot rule — the
navigator is present by definition, having just chosen the mockup, so ask them to look and merge it.
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

Then take the next bead with no user-facing surface. A bead with one cannot be planned while the
navigator is away, and pretending otherwise puts the decision in the wrong hands.

## Too big for one increment

Split it. `bd create --parent <id>` for the children, `bd dep add` for the order, and plan only the
first — later children would be planned against a codebase their siblings are about to change.

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

## Finishing

Label `planned`, `bd unclaim`, `bd dolt push`, and say which bead you planned and what the navigator
decided. Then take the next one.
