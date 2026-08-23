# ah-wbr9 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-23
- **PR:** #621

## The plan's verbatim user-facing message could not be produced by the rule the same plan gave

**What happened.** The plan quoted five messages "verbatim", among them
`cannot produce catapults: needs carpenter 4, has carpenter 2`, and in the same document said —
twice, once in *Files to change* and once in *Known traps* — to print the item's catalogue `name`
and to pluralise nowhere in Rust. `config/public/ruleset.json` spells `CATP.name` as `catapult`,
singular, so no implementation can satisfy both. The two other item names in the sample messages
(`iron`, `quicksilver`) happen to be spelled the same either way, so the conflict shows up on
exactly one of the five sentences. I followed the rule, shipped `catapult`, and flagged the
deviation in the PR body for the navigator to overrule.

**Why.** The wording was interviewed with the navigator against sample sentences written by hand;
nothing checked those samples against the catalogue the mechanism actually reads.

**Cost.** About ten minutes of reading and a paragraph of PR body — small, but the wording is
user-facing, which is the one class of decision an implementer is not supposed to settle alone.

**Prevent by.** When a plan states a user-facing string verbatim *and* names the data field it is
built from, `plan-bead` should check one against the other before the interview closes — here a
single `jq '.items.CATP.name' config/public/ruleset.json`. A sample sentence the stated mechanism
cannot emit is a decision that silently falls to the implementer.

**Seen before.** `ah-k6i.6` — the plan's own code snippet contradicting the plan's own rule, the
same failure in a different medium.
