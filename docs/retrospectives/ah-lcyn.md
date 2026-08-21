# ah-lcyn — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-21
- **PR:** #502

## Copilot's error notice has a cause, and it is a permanent one: the reviewer runs a model this account cannot use

**What happened.** `gh pr edit 502 --add-reviewer @copilot` produced a `COMMENTED` review within two
minutes whose whole body was "Copilot encountered an error and was unable to review this pull
request." — the fourth recorded sighting. Unlike the three before it, the navigator asked for the
job log, so this one has a diagnosis rather than a guess.

**Why.** Established, from the reviewer's own Actions job. It checks the PR out, reads both custom
instruction files, builds a 56,805-token prompt, and then dies nine seconds in, before reading any
of the diff:

```
Creating copilot-sdk session with model: capi-prod-gpt-5.6-luna[ReasoningEffort=xhigh]   (×4, an ensemble)
Error creating PR review request: Request session.create failed with message:
  Model "gpt-5.6-luna" is not available.
##[error]Process completed with exit code 1
```

The action is pinned to a four-member ensemble on `gpt-5.6-luna`, and `api.individual.githubcopilot.com`
— this account's individual Copilot plan — refuses it. It is warned about one line earlier:
`CCR settings not configured for model 'gpt-5.6-luna', applying default settings`.

**This is not flakiness and re-requesting cannot help.** The failure is before the diff, identical
every time, and outside the repository's control. It stays until GitHub rolls the model out to this
plan or the action falls back to an available one. So the fleet has no automated second pair of eyes
at all right now — every PR behind this one is in the same position, which is worth knowing before
another implementer spends its twenty-minute wait discovering it.

**Cost.** Two review requests, roughly fifteen minutes of waiting and polling, one round trip to the
navigator to read the log, and a second to settle what to do with an unreviewable PR. The bead
itself was green throughout.

**Prevent by.** Two things, both the navigator's to decide, neither an implementer's:

1. **Diagnose once, not per bead.** When a Copilot review body is the error notice, the useful next
   step is `gh run view --job <id> --log` on the `copilot-pull-request-reviewer` job — nine lines of
   which say whether it is transient or structural. Worth naming in CLAUDE.md's Four Eye Principle
   beside the twenty-minute rule, so the next implementer does not have to be told.
2. **CLAUDE.md has no path for a reviewer that is down rather than slow.** Its fallback — escalate
   to the `human` queue — is written for a review that never arrives, and it parks a finished,
   green PR indefinitely while the outage lasts. ah-hiib.2 said the rules had no path for this on
   the third sighting; on the fourth there is now a known cause, and the question is whether the
   navigator reviewing in Copilot's place (which is what happened here) should be a stated option
   rather than an ad-hoc one.

**Seen before.** ah-hiib.2 (third sighting, no cause established), ah-60m (three times in one run),
ah-yk6b (twice in one run). This is the fourth, and the first with a root cause.
