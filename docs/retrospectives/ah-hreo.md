# ah-hreo — retrospective

## The bug was fixed on main by another bead while this one was in review

**What happened.** ah-hreo (a GIVE the SHARE pool funds only in part takes nothing from the sharer) and ah-2fn5 (a GIVE is lent for at the cast moment, after later GIVEs refill the sharer) were both filed by Bishop on 2026-10-13 against the same code, Lending::settle's cast moment, and both were claimed by bugfixers at the same time. ah-2fn5's fix (#1552) treats the general case, a GIVE lent for as it runs, and covers ah-hreo's example: its test a_gift_the_pool_funds_in_part_drains_the_sharer is ah-hreo's reproduction case. ah-2fn5 merged while ah-hreo's PR was in review. The rebase conflicted, and this PR was reduced to regression tests.

**Why.** The two descriptions name the same root cause (the purse claims a GIVE's overdraft at the cast moment rather than as the GIVE runs) from two symptoms. Nothing compared them when they were filed or handed out, and neither bead links to the other.

**Cost.** About an hour of a bugfix session: a fix, a cold-read review, two follow-up tests and a CI wait for an implementation change main already had.

**Prevent by.** When `scripts/bugfix-candidates` hands out a bead, checking the other open and in-progress bugfix beads for one whose description names the same function (here `Lending::settle`) and holding the second until the first merges. Or Bishop, when filing several findings from one sweep against one function, filing them as one bead or linking them with `bd dep add`.

**Seen before.** No retrospective about a duplicate fix found.

## Two PRs that merged green apart broke main's test build together

**What happened.** ah-nd0e (#1555) changed the test helper `silver_shipped` to take the orders document. ah-2fn5 (#1552), merged just before it, added four tests that call `silver_shipped(&review, "902")` with the old two arguments. Each PR was green on its own base. On main at 41ef4a36, `cargo test -p atlantis-hud-core` did not compile, which turned every open PR red. This PR repaired the four call sites, and then dropped that commit when ah-eoag (#1557) merged the same repair first.

**Why.** A semantic conflict that git merges without a marker. `main` requires checks but not an up-to-date branch (`strict` is false), so #1555 merged without CI ever running on a base that contained #1552.

**Cost.** About fifteen minutes here, a second rebase, and main red for every PR until #1557 merged. Two sessions (this one and ah-eoag) repaired it independently.

**Prevent by.** The fix already proposed in ah-8n8y and ah-agze: a merge queue, or `strict` required status checks on `main`.

**Seen before.** ah-8n8y, ah-agze (the same shape).
