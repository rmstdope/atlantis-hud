# ah-hwkak.1 — retrospective

## `git push` finished its work and then hung for ten minutes

**What happened.** The first `git push -u origin HEAD` updated the remote branch, but the process never exited. `git remote-https` and `git-remote-http` sat idle with no output, and the `gh pr create` chained after the push never ran. `git ls-remote` against the same remote answered in under a second. Killing the push ended it with `fatal: the remote end hung up unexpectedly`, and a re-run said `Everything up-to-date`, so the branch had been there all along.

**Why.** Not established. The HTTPS transport stalled after the ref update. It was not waiting on credentials, because `GIT_TERMINAL_PROMPT=0` pushes worked straight afterwards.

**Cost.** About twelve minutes: one tool call timed out, and a background wait loop polled for a PR that the hung chain was never going to create.

**Prevent by.** The producer skill's *Building* section could say to run the first push on its own, not chained to `gh pr create`, under a watchdog (`GIT_TERMINAL_PROMPT=0 git push ... & p=$!`, kill after about 90s). After that, check `git ls-remote --heads origin <branch>` against `HEAD` before treating a killed push as a failure.

**Seen before.** No earlier retrospective has this symptom.

## Playwright's headless shell vanished between two local smoke runs

**What happened.** The plan's smoke spec passed at 11:2x. Twenty minutes later every walk in the same spec failed with `browserType.launch: Executable doesn't exist at ~/Library/Caches/ms-playwright/chromium_headless_shell-1234/...`. The `-1234` folder had gone from the shared cache while other sessions were running. `pnpm exec playwright install chromium` downloaded it again in about a minute, and the spec passed.

**Why.** Not established. The likeliest cause is another session's `playwright install` garbage-collecting the browser builds its own version does not use, in the cache every session on this Mac shares.

**Cost.** About three minutes, plus one wasted smoke build.

**Prevent by.** The project's smoke entry (`scripts/withGateLock.ts` or `ensure-wasm.mjs`) could check that the pinned browser exists and install it if not, so the error never reaches a walk.

**Seen before.** ah-07tn, ah-9bli1 and ah-9qdz.2 record the same `Executable doesn't exist ... chromium_headless_shell-1234` error.
