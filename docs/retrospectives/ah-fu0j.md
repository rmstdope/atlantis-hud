# ah-fu0j — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-05
- **PR:** #987

## A Python string-replace edit silently did nothing, and I told the reviewer it had worked

**What happened.** Answering a review finding, I removed a dead `create_dir_all` line from
`crates/core/tests/mage_sheet_fixtures.rs` with a `python3 -c "s.replace(<the exact source>, '')"`
one-liner, committed, pushed, and posted "the unreachable create_dir_all is gone" on the PR. It was
not gone. `cargo fmt` — which I had run in an earlier increment — had reflowed that statement across
two lines, so the single-line text I was matching on no longer existed in the file, `str.replace`
found nothing, and returned the string unchanged. Nothing failed: no error, no diff hunk missing
from a summary I read, and `check:fast` stayed green because the line was dead either way. The next
delta round caught it by opening the file.

**Why.** Established. `str.replace` on a miss is a no-op that returns successfully, so a
heredoc-Python edit has no failure mode a shell exit code can express — unlike `Edit`, which errors
when `old_string` does not match. Combined with `cargo fmt` rewriting the very lines I was later
matching on, an edit written against source I had read *before* the formatter ran was matching text
that no longer existed.

**Cost.** One review round and one CI cycle, about nine minutes, plus a false claim posted to a PR —
which is the part that matters: had the reviewer taken my answer at its word, a finding would have
been recorded as fixed while the code still carried it.

**Prevent by.** Two things, in order of strength. First: in `implement-bead`'s *Answering it, and
going on*, the existing rule that a PR-body sentence about a helper must be run or read before it is
written should say the same about an answer to a finding — **grep for the thing you claim to have
removed before claiming it**, in the file, not in your memory of the edit. Second, and cheaper:
prefer the `Edit` tool over `python3 -c "...replace..."` for a targeted deletion, because a
non-matching `Edit` fails loudly, and every silent no-op in this run came from the Python form.

**Seen before.** None found — `grep -rl` over `docs/retrospectives/` for "silently missed",
"no-op edit" and "re-read the file" returns nothing.

## The same one-liner form cost an increment earlier in the run

**What happened.** Probing whether a new lockstep guard actually bites, I removed one entry from
`ALL_MAGE_SHEETS`, saw the test fail correctly, and restored it with `git checkout <file>` — which
also discarded the uncommitted increment-2 work in that same file, since the increment was not yet
committed. I had to re-apply the whole edit.

**Why.** Established: `git checkout <path>` restores to HEAD, not to "before my probe", and HEAD did
not yet contain the increment.

**Cost.** About four minutes and one re-applied edit. Small, and recorded only because it shares a
root with the finding above: an edit whose undo I had not thought through.

**Prevent by.** Commit the increment *before* probing that its guard fails, then `git checkout` is
exactly the right undo. Worth a line in `implement-bead`'s *Building* section, next to the
increments-in-order rule: if you are going to deliberately break something to watch a test fail,
commit first.
