# ah-60m — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-17
- **PR:** #398

## A failed glob hid an existing test file, and I overwrote it

**What happened.** Checking whether `TradePanel` already had a test, I ran
`ls packages/shared/src/workspace/*Trade* packages/shared/src/workspace/*trade*` in one command. The
second pattern matched nothing, so zsh aborted the whole command with `no matches found` — including
the first pattern, which *would* have matched `TradePanel.test.tsx`. Reading that as "no test
exists", I wrote a new `TradePanel.test.tsx` with `Write`, destroying nine existing tests. It was
caught only by `git status` before the first commit showing the file as `M` rather than `??`, and
recovered with `git show HEAD:<path>`.

**Why.** zsh's `nomatch` aborts the command rather than passing the pattern through as bash does, so
one unmatched pattern in a multi-pattern `ls` discards the results of every other pattern. Nothing in
the output says which pattern failed, and the exit status is the only other signal.

**Cost.** About ten minutes to notice and restore, and it very nearly cost nine tests silently: had
I committed before running `git status`, the loss would have been invisible in a diff nobody reads
line by line, since the file appears as a plausible rewrite.

**Prevent by.** `Write` refuses to overwrite a file the session has not read — that guard did not
fire here because I had never read it, which is exactly the case where it matters most. Two things
would have caught it: checking existence with a single pattern per command (or `ls <dir> | grep -i
trade`, which cannot abort), and treating a `Write` result that says *updated* rather than *created*
as a stop signal. The result text does distinguish them; I did not read it.

**Seen before.** none found.

## Copilot returned an error notice three times instead of a review

**What happened.** The review requested on PR open came back within a minute as
`Copilot encountered an error and was unable to review this pull request.` — a `COMMENTED` review
with no read behind it. Two further requests (one authorised by the navigator) returned the same
notice, and for a stretch `api.github.com` was answering `HTTP 503` to `gh` outright. The real review
arrived about three and a half hours after the PR opened, once GitHub recovered, and found a genuine
defect.

**Why.** A GitHub incident. Not the PR: the same request succeeded unchanged once the service
recovered.

**Cost.** About three and a half hours of wall-clock on a bead whose build took under an hour, two
questions to the navigator, and a session parked in `asking` twice.

**Prevent by.** Two concrete things, both for whoever revises `implement-bead`. First, the
wait loop should treat a Copilot review whose body matches `encountered an error` as **no review**
rather than as the review — as written, `[.reviews[] | select(.user.login | startswith("copilot"))] |
length` counts it and the wait ends satisfied with nothing to answer. Second, the twenty-minute
escalation rule has no answer for "the reviewer is erroring, not absent": escalating parks a green,
finished bead over an outage, and the skill's one-request rule forbids the retry that actually fixes
it. Both times the navigator chose to retry, which suggests the rule wants an explicit exception for
a review that reports its own failure.

Worth noting for the same reader: `gh api repos/<owner>/<repo>/pulls/<n>/reviews` failed with
`unexpected end of JSON input` throughout the incident while `gh pr view <n> --json reviews` kept
working. A `--jq` filter over the failing endpoint yields an empty string, and
`[ "$n" != "0" ]` on an empty string is *true* — so the skill's suggested wait loop exits
immediately and silently claims a review arrived. The loop needs `[ -n "$n" ]` as well.

**Seen before.** none found.
