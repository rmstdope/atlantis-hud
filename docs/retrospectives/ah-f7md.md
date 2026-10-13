# ah-f7md — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-10-13
- **PR:** #1565

## The review sub-agent reported "waiting on its own background work" and delivered nothing for about forty minutes

**What happened.** The `reviewer` sub-agent spawned for PR #1565 (opus, medium) returned a completion
notification after about twelve minutes whose result read "This agent has not reported yet: it is
waiting on its own background work and will deliver its report through SubagentHandback when that
finishes." My turn ended in phase `review`, as `produce-bead` *Waiting, without ending your run*
allows. Nothing arrived until the fleet view prompted the session and I sent the sub-agent a
`SendMessage` asking for its report; the findings then came in through a hand-back message about
forty minutes after the spawn. Its own report says it had built a probe copy against the worktree's
`target` and run the semantics suite: the background work was a cargo build and test.

**Why.** Not established beyond the above: the sub-agent backgrounded a long cargo run and the
hand-back waited on it, without a time limit and without a prompt to the parent.

**Cost.** About thirty minutes of wall-clock with the claim held and CI already green, plus one
cerebro nudge.

**Prevent by.** `.cerebro/cerebro/agents/reviewer.md`, the sub-agent mode: say that a review
sub-agent runs any build or test in the foreground with an explicit timeout and never in the
background. In `skills/produce-bead/SKILL.md` *The review loop*: say that a result reading "has not
reported yet" is not a review, and that the producer sends one `SendMessage` asking for the report
rather than ending its turn on it.

**Seen before.** None found.
