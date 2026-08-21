# ah-o2li — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-21
- **PR:** #512

## Copilot errored three consecutive times before producing a review

**What happened.** The review requested on PR open came back as `COMMENTED` with the body
"Copilot encountered an error and was unable to review this pull request. You can try again by
re-requesting a review." A re-request (approved by the navigator, since one-review-per-bead forbids
it unasked) errored identically. A third attempt, made by the navigator on GitHub, finally produced
a real review — with no comments.
**Why.** Not established; it is on Copilot's side. Three failures in about fifteen minutes reads as
an outage rather than a per-PR fault.
**Cost.** About twenty-five minutes and two questions to the navigator, the second of which timed
out — the navigator's answer and cerebro's give-up line arrived in the same message.
**Prevent by.** `implement-bead`'s *The review* covers a review that never arrives and a review that
arrives; it has no answer for one that arrives as an error, so the implementer must ask. If the
navigator wants that decided in advance, the rule wants a clause: an errored review is not a
fulfilled request, and may be re-requested N times before the bead escalates.
**Seen before.** ah-60m, ah-hiib.2, ah-lcyn, ah-yk6b — same error text. This is its fifth recorded
sighting.

## A smoke test failed locally three times and passed in CI

**What happened.** `pnpm run test:smoke` failed on
`workspace.spec.ts:3819 › the faction view uses the window before it scrolls`, in both the `web` and
`desktop-shell` projects. It failed again with this branch's uncommitted changes stashed, which is
what established it was not mine. All four smoke shards then passed in CI on the same commit.
**Why.** Not established. The spec is about viewport height, and this machine's headless window is
presumably not the runner's — but I did not prove that.
**Cost.** About fifteen minutes: one full local smoke run to see it, one stashed re-run to clear
this bead of it.
**Prevent by.** `implement-bead`'s *Building* says to run `test:smoke` once when a bead adds a test
to it. Worth adding there: run only the added spec (`pnpm exec playwright test <file> --project=web`)
rather than the whole suite, since CI runs the rest anyway and a pre-existing local-only failure
costs an implementer a stash-and-rerun to attribute.
**Seen before.** none found.
