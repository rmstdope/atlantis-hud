# ah-hiib.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-21
- **PR:** rmstdope/cerebro#64, and the pin bump in this repository

## Copilot answered with its own error, for the third recorded time, and the rules still have no path for it

**What happened.** `gh pr edit 64 --add-reviewer @copilot` produced a `COMMENTED` review within a
minute whose entire body was "Copilot encountered an error and was unable to review this pull
request. You can try again by re-requesting a review." No comments, no read. All three CI jobs were
green. `implement-bead`'s wait loop counts that as a review and ends satisfied, and its one-request
rule forbids the retry the notice asks for, so the run stopped and asked the navigator. They chose a
third option neither the rules nor the two earlier retrospectives had considered: **spawn a subagent
to review it.** That review found two defects that would have shipped — the summary aggregated the
open interval into the median it was about to be compared against, so a stall raised its own
baseline until it cleared the bar it set (and with one interval could never be marked at all), and
nothing closed the last interval of a session that ended, so an agent that ran once would have been
reported as running for ever. Both invert what the bead was for.

**Why.** The Copilot error is not established and is not this PR's: `ah-yk6b` saw the same notice
resolve itself hours later when a GitHub incident ended. What *is* established is that the rules
treat "no review" and "an errored review" as the same thing, and both earlier sightings ended in a
question to the navigator rather than in a documented step.

**Cost.** About fifteen minutes and one navigator question. Cheap this time — but the subagent
review took six minutes and found two purpose-inverting defects, which is the real number here: the
escalation path the rules do offer would have parked a green PR carrying both.

**Prevent by.** `implement-bead`'s *The review — you get exactly one* needs the case written down,
and the navigator has now chosen the same remedy under a name the skill does not use. Concretely,
for whoever revises it: (1) the wait loop must treat a Copilot review whose body matches
`encountered an error` as **no review**, since as written it counts one and ends the wait with
nothing to answer; (2) the response to a reviewer that reports its own failure should be a subagent
review, not the twenty-minute escalation — escalation is for a reviewer that never came, and it
parks finished work over an outage. This is the third sighting and the second time the fix has had
to be invented at the terminal.

**Seen before.** `ah-60m` (one authorised re-request, also errored; navigator reviewed by hand),
`ah-yk6b` (three errored requests during a GitHub incident; the real review arrived three and a half
hours later and found a genuine defect). Both name the same missing rule.

## A subagent review is worth its cost on a bead nobody else will look at

**What happened.** The subagent reviewer was given the diff, the bead's rules, and licence to build
fixtures and try to break the script. It did: it wrote its own log fixtures, pinned the clock, and
produced a concrete failing scenario for each finding — "one 5-minute `asking`, then 685 minutes
stuck, median 345, threshold 690, unmarked". Two findings were real defects, three were weak tests
that were themselves the reason the defects got through, and it separately listed nine things it
tried to break and could not.

**Why.** Not a failure — recorded because the cost is now known and the alternative was nothing.

**Cost.** About six minutes and 73k tokens, against two defects that inverted the feature's purpose
and would have reached the navigator's own fleet view.

**Prevent by.** Nothing to prevent. Worth knowing when the same choice comes up: a reviewer briefed
with the *rules the implementation is supposed to honour* — not merely "review this diff" — is what
produced the findings, since both defects were violations of stated rules rather than bugs visible
from the code alone. Whoever writes the subagent-review step into `implement-bead` should carry that
across.
