# ah-rgkk.3.3 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-06
- **PR:** #1013

## A plan that rewrites a user-visible string has to name the smoke specs asserting it

**What happened.** Decision **T2** deliberately rewrites eight sentence families in `itemsTooltip`
— the `was: …` lead, the three `Includes …` restatements, the `Spends …` build line and the moved
`Sends …` lines. The plan's *Test plan* named the two files whose assertions would move
(`unitCellPopup.test.ts`, `unitPreview.test.ts`) and said explicitly "`UnitCellPopup.test.tsx` —
**untouched**" and "**No smoke test**". It named nothing in `tests/smoke/`. Six smoke specs assert
that wording through the cell's `sr-only` sentence, and CI's `smoke (web, 2, 2)` and
`smoke (desktop-shell, 2, 2)` shards went red on all six:
`workspace.spec.ts:4466`, `:4490`, `:4511`, `:4568`, `:4594`, `:4648`. `pnpm run check:fast` was
green throughout, because the browser suites are not in the fast gate.

**Why.** The plan reasoned about the smoke suite only as a place a *new* test might go, and
concluded correctly that none was needed. It never asked the other question — which existing specs
read the strings this bead rewrites. One line would have listed them:
`grep -n "was: \|this unit will produce\|this unit will summon" tests/smoke/*.ts`.

**Cost.** One CI cycle (~12 minutes) to discover, then a local smoke run to fix against observed
strings rather than guesses, then the full web suite to confirm — about 40 minutes.

**Prevent by.** `plan-bead`'s *Test plan* section should require, for any bead that changes or
removes a string the application renders, a grep of `tests/smoke/` for that string, with the
result written into the plan — the same way it already requires the unit-test files to be named.
"No new smoke test is needed" is a different claim from "no smoke test asserts this", and only the
first was made here.

**Seen before.** `ah-rgkk.1` — same family, same file, adjacent line numbers (`4398`, `4466`,
`4486`…), and the same shape: a plan named the unit-test assertions to move and missed eleven smoke
specs, "found only by running the full suite: `pnpm run check:fast` is green throughout, because
none of it is in the fast gate." `ah-rgkk.2.1` is the same lesson from the other side — a plan named
one test literal a required field would break, and there were eight. **This is the third sighting in
one family.**

## A sibling bead's new required wire field landed mid-flight, and only CI could see it

**What happened.** While this branch was open, `ah-rgkk.4.1` merged and added a required
`isMan: boolean` to `ItemChange` in `packages/core-client/src/index.ts`. Seven `ItemChange` fixtures
in this branch's two test files stopped satisfying the type. `pnpm run check:fast` stayed green in
the worktree — it typechecks the branch, whose own `core-client` does not have the field — so the
first sight of it was CI's `checks` job failing typecheck with thirteen `TS2741` errors, on a merge
commit that exists nowhere locally.

**Why.** Not a defect in anything: it is what a shared type plus concurrent beads produces. Worth
recording because of *where* it is detectable. The fast gate cannot see it by construction, and the
`strict` branch-protection setting is `false` on this repository (here the protection call 404s, so
this bead read it as `true`), which means a `BEHIND` branch may otherwise merge without ever
compiling against current main.

**Cost.** One CI cycle plus a rebase and fixture pass, about 20 minutes.

**Prevent by.** When a bead's plan names a type that a sibling bead in the same family is also
changing — this family has `ah-rgkk.3.1`, `3.2` and `4.1` all editing `ItemChange` — the implementer
should `git fetch origin main && git log HEAD..origin/main --oneline` before the *first* push, not
only before the merge, and re-run the gate on the rebased branch. It costs a minute and moves this
class of failure off the CI cycle.

**Seen before.** `ah-rgkk.2.1` — same required-field-breaks-fixtures shape, from the bead that added
the field rather than a neighbour's.

## A scripted rewrite of test expectations over-removed, and nearly did so invisibly

**What happened.** Rewriting the `itemsTooltip` expectations by hand across ~26 tests looked like
mechanical work, so I did it with a script that joined each expectation's string literals, dropped
the lines the bead removes, and re-emitted. It dropped every `Spends …` line, and that was wrong for
ten of them: a builder with no `build-spent` movement still says `Spends …`. The suite went green
because the *implementation* at that moment also dropped them — the script and the code shared one
mistake, so the tests agreed with the bug. It surfaced only when a later review finding made me
restore the line and ten expectations then failed.

**Why.** A script that derives expectations from the change being made cannot catch that change
being wrong; it encodes the same assumption twice. The reviewer named this independently — "a
scripted rewrite of assertions is exactly where a weakened test hides" — and re-ran every changed
assertion against the pre-change sources to prove they were genuine regressions.

**Cost.** About 15 minutes to rebuild the expectations from the pre-rewrite commit with a corrected
rule, and one review round that would otherwise have been unnecessary.

**Prevent by.** When more than a handful of expectations must move, regenerate them from the
**pre-change** file with an explicit rule, then check each rewritten assertion still fails against
the old code — which is what proves it is a regression test and not a transcript of current output.
`implement-bead`'s *The review loop* already asks the reviewer to do this for a delta; the
implementer should do it before pushing.

**Seen before.** None found for the scripted-rewrite half; `ah-rgkk.2.1`'s "I relaxed the
accept-on-doubt regression bar instead of satisfying it, and only the review caught it" is the same
failure mode reached by a different route.
