# ah-slxi7 — retrospective

## The skill's strictness check answers 404 here, which it reads as strict

**What happened.** `produce-bead`'s *Merging* section decides whether a `BEHIND` head may merge from
`gh api repos/<owner>/<repo>/branches/main/protection --jq '.required_status_checks.strict'`, and
reads a failed call as `true`. On this repository that call always fails with `Branch not protected
(HTTP 404)`: `main` is governed by a ruleset, not classic branch protection. Read as written, every
bead would catch up with `update-branch` and spend a second full CI cycle (about 12 minutes) for
nothing, since the ruleset's own answer is `false`.

**Why.** The legacy protection endpoint does not see rulesets. The ruleset's setting is at
`gh api repos/<owner>/<repo>/rules/branches/main --jq '.[] | select(.type=="required_status_checks") | .parameters.strict_required_status_checks_policy'`,
which prints `false` here.

**Cost.** A few minutes on this bead (noticed before acting); a CI cycle per bead for anyone who
follows the fail-safe reading.

**Prevent by.** `.cerebro/cerebro/skills/produce-bead/SKILL.md`, *Merging*: query the rules endpoint
above (falling back to the protection endpoint), so a ruleset-governed repository gets its real
answer instead of the fail-safe one.

**Seen before.** Not in `docs/retrospectives/` at the time of writing.
