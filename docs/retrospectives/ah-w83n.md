# ah-w83n — retrospective

## A native assertion anchored at `^` failed on the WebDriver bridge's wrapping

**What happened.** The new every-query loop in `tests/native/binding.spec.ts` asserted that each
refusal matched `/^arguments could not be read: /u`. Locally that text is exactly what the core
returns: the core-tauri and real-wasm tests that check the same thing were green. In CI's `native` job
all ten cases failed. The refusal arrived as `WebDriverError: arguments could not be read: invalid
length 0, … when running "execute/async" with method "POST"`.

**Why.** `invokeNative` (`tests/native/helpers.ts`) hands back the error text the WebDriver bridge
reports, not the core's raw string, and the bridge prefixes and suffixes it. Nothing local runs
that path: the native suite is Linux/WebKitGTK and CI-only.

**Cost.** One CI cycle (about 10 minutes) and one of the bead's three fix attempts. Reading the log
also cost a detour: `gh run view --log-failed` refuses while sibling jobs are still running (seen
before in ah-0ial and ah-0w7w), and `gh api repos/<owner>/<repo>/actions/jobs/<job>/logs` refuses
too unless given `--allow-escape-sequences`.

**Prevent by.** A comment on `invokeNative`'s `error` field in `tests/native/helpers.ts` saying the
text is wrapped as `WebDriverError: <core text> when running …`, so an assertion on a native error
matches unanchored, as `BINDING_FAILURE` in `binding.spec.ts` should be checked to do. To read a
finished job's log while its run is still going:
`gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs --allow-escape-sequences | sed 's/\x1b\[[0-9;]*m//g'`.

**Seen before.** The in-progress `--log-failed` refusal: ah-0ial, ah-0w7w. The WebDriver wrapping:
not before.
