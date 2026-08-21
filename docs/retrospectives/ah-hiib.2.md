# ah-hiib.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-21
- **PR:** #496, and rmstdope/cerebro#64 for the work itself

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

**Why.** The Copilot error is not established and is not this PR's: `ah-60m` saw the same notice
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

**Seen before.** `ah-yk6b` (PR #485: one authorised re-request, also errored; the navigator then
read the PR by hand and found nothing), `ah-60m` (PR #398: three errored requests during a GitHub
incident, with `api.github.com` returning 503 outright; the real review arrived three and a half
hours later and found a genuine defect). Both name the same missing rule.

**What the remedy cost, for whoever writes it down.** The subagent review took six minutes and 73k
tokens. It was briefed with the *rules the implementation was supposed to honour*, not merely
"review this diff", and that is what produced the findings: both defects were violations of stated
rules rather than bugs visible from the code alone. It gave a concrete failing scenario for each —
"one 5-minute `asking`, then 685 minutes stuck, median 345, threshold 690, unmarked" — and listed
nine things it tried to break and could not. It then caught two swapped citations in this very file
on the pin PR. Whoever adds the step should carry the briefing across, not just the idea.
