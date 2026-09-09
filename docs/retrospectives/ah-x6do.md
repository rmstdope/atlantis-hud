# ah-x6do — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-09
- **PR:** #1097

## A new advisory suppressed in favour of an existing one inherited that one's off switch

**What happened.** The plan decided the new `withdraw-not-a-basic-item` advisory should be "silent
in the Nexus, where `withdraw-in-nexus` already speaks", and gave the guard to write:
`if withdrawal_refused(hex.region) || !options.emits(...) { return; }`. Implemented exactly as
written, that is wrong: `check_withdraw_in_nexus` is itself gated on
`options.emits(codes::WITHDRAW_IN_NEXUS)` (`crates/core/src/orders/semantics.rs:11902`), so a player
who had switched the Nexus row off got **no finding at all** for `WITHDRAW 500 SILV` in a Nexus hex,
while the same change removed the silver from the ITEMS column. One Settings row silently switching
off another is precisely the failure mode the navigator gave, in the plan's own *User-facing
decisions*, as the reason for rejecting round one's option C. The review sub-agent's first cold read
caught it; the fast gate, the full Rust suite and CI were all green with the defect in.

**Why.** A plan that suppresses a new advisory in deference to an existing one is reasoning about
what the *code* does, and a check's emit gate is invisible at that altitude — the plan quoted
`check_withdraw_in_nexus`'s behaviour but not its guard.

**Cost.** One review round and one CI cycle, about twenty minutes. Cheap only because the reviewer
read the plan's *User-facing decisions* and noticed the contradiction; nothing mechanical would have.

**Prevent by.** `plan-bead`, where a plan decides one advisory is silent because another speaks:
state what the player sees when that other one is switched off, and name it as a test in the *test
plan*. Every advisory in this codebase has an off switch, so "X already says so" is never
unconditional. This bead's own `a_nexus_withdrawal_is_still_refused_when_the_nexus_warning_is_off`
(`semantics.rs:25609`) is the shape of that test.

**Seen before.** None found — `grep -rl "switched off\|silently switch" docs/retrospectives/`
returns nothing.

## The plan named three shipped tests that would see the new warning; there were five

**What happened.** The plan's increment 2 listed, by name and line, three shipped tests asserting an
exact set of findings that the new advisory would break, and called them out as a trap. Running
`cargo test -p atlantis-hud-core --lib` produced **five**: also
`an_unpriceable_withdrawal_leaves_the_upkeep_settlement_inactive` (`semantics.rs:24238`) and
`an_order_nothing_can_price_leaves_the_report_weights_standing` (`semantics.rs:31713`), both of which
use an unpriceable withdrawal (`WITHDRAW 1 longship`, `WITHDRAW 20 LONG`) as a fixture for something
else entirely.

**Why.** The plan appears to have found its three by searching for the *withdrawal* tests. A fixture
that withdraws something unpriceable in order to test ship weights or upkeep settlement does not read
as a withdrawal test and would not come up that way.

**Cost.** Small — about five minutes, and the compiler named both. Recorded because the plan
presented its list as exhaustive and as a trap, which invites an implementer to trust it.

**Prevent by.** Nothing in the instructions: the suite named them immediately, which is the system
working. Worth knowing only as a reminder that a plan's list of tests-that-will-break is a starting
point, not a closed set — run the suite and believe it over the list.

**Seen before.** None found.
