# Running the agent workflow

Work on this repository is split between two kinds of agent session. This is the human's guide to
running them: what to start, what you will be asked, where to look when something wants you, and
what it costs.

The agents' own instructions live in `.claude/skills/plan-bead/`, `.claude/skills/implement-bead/`
and `.claude/skills/beads-workflow/`. You do not need to read those to operate this.

## The idea

A **planner** turns rough beads into plans. A **builder** builds them. They are separate sessions
because they need different things from you: planning needs your judgement on anything a player will
see, and building needs nothing at all if the plan is good.

The handover is one label. A bead is *planned* or it is not.

```
  unplanned  ──►  planner claims  ──►  planned  ──►  builder claims  ──►  merged, closed
                        │                                   │
                        └──────── needs you ◄───────────────┘
```

## Starting a planner

One session, in its own terminal:

```
claude --model fable        # or opus; the skill will tell you if it is on something else
/plan-bead
```

It takes the next unplanned bead that is not blocked, researches it, and writes a plan into the
bead. Then the next one, and the next.

**It will interrupt you**, and this is the part worth your attention. Anything a player sees —
layout, wording, what a control is called, what happens on a click — is yours to decide, not the
agent's. It will propose, usually with a self-contained HTML mockup you can open in a browser, and
wait for you to choose. Architecture, file layout, test shape and ordering it decides by itself.

If you walk away mid-question, it parks that bead and moves to one with no user-facing surface, so
the queue keeps filling. It will not guess on your behalf.

## Starting builders

One or more sessions, each in its own terminal:

```
claude
/implement-bead
```

Each one takes a planned bead, creates its own git worktree, works through the plan test-first, opens
a PR, answers the Copilot review, waits for CI, merges, cleans up, and takes the next bead.

**Two or three is a sensible number on one machine.** More is not faster: the browser test suites
take a machine-wide lock and run one at a time, and every merge makes every other open PR stale, so
each of them pays for a rebase and a fresh CI run.

## Your queue

Everything waiting on you, from every agent and every terminal, in one place:

```bash
bd human list
```

Beads arrive there for four reasons: a plan turned out to be wrong in a way the builder must not
decide; a plan was missing something; the Copilot review never came; or CI stayed red after three
attempts. The bead says which in its notes.

To put one back into circulation after you have answered:

```bash
bd update <id> --add-label planned --remove-label human    # back to the builders
bd update <id> --remove-label human                        # back to the planner
```

## Watching without interfering

```bash
bd ready --label planned      # what builders can pick up
bd list --status in_progress  # who is on what
bd human list                 # waiting on you
gh pr list                    # what is in flight
git worktree list             # which agent is in which directory
```

The one thing not to do is work in `.claude/worktrees/` yourself — those belong to running agents,
and checking out a branch there moves an agent off its own work.

## What it costs

Honest numbers from building this repository's own harness:

- **A bead is an hour or more**, most of it CI. The code is usually the short part.
- **Expect a rebase on nearly every merge.** With several agents, a PR that sat through one review
  round has usually been overtaken, and the rules require a rebase plus a fresh CI cycle before it
  can merge. That is deliberate: a green run on a stale tree is evidence about a tree that will never
  exist.
- **Copilot reviews about four PRs in five**, sometimes minutes late, and never marks one approved.
  When it does not review, the builder leaves the PR open and tells you rather than merging.
- **Nothing merges unreviewed and nothing merges red.** The `main` ruleset enforces the second on the
  server; the first is the agents following the rule.

## When something goes wrong

**An agent died and its bead is stuck.** A crashed session leaves its bead claimed and invisible.
After about fifteen minutes of silence:

```bash
bd reclaim --id <bead> --older-than 10m
git worktree remove --force .claude/worktrees/<bead>
git worktree prune
```

Only ever by `--id`. Without it, that command reaps every stale claim on the machine, including from
an agent that is merely busy.

**Two agents want the same ports.** Each builder picks a block of three (4173, 4183, 4193, …) and
checks it is free first. A collision fails loudly rather than testing the wrong bundle, but it stalls
both — give them different blocks.

**The disk fills.** The Rust build tree is shared by every worktree and still grows:

```bash
pnpm exec tsx scripts/diskPreflight.ts     # what is free, and whether it is enough
rm -rf target/debug/incremental            # the cheap few gigabytes back
```

**A bead keeps coming back to you.** That usually means the plan is wrong rather than the builder is:
send it to the planner (`--remove-label human`, leave `planned` off) rather than to another builder.

## What agents never decide

- Anything a player sees. That is the whole reason the planner talks to you.
- Whether to take a bead off another agent, beyond the narrow crashed-agent case above.
- Anything outside a planned bead — a change to these rules, to the workflow, or to CI.
- Whether to merge something red, stale, or unreviewed.
