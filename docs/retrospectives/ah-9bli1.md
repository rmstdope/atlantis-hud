# ah-9bli1 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-10-24
- **PR:** #1873

## The local smoke run found no headless shell, and installing one hung for twenty minutes

**What happened.** I ran the plan's local validation with `smoke-port -- pnpm exec tsx scripts/withGateLock.ts pnpm exec playwright test tests/smoke/workspace.spec.ts -g ...`. All four walks it selected failed with `browserType.launch: Executable doesn't exist at ~/Library/Caches/ms-playwright/chromium_headless_shell-1234/...`, two of them walks this bead did not touch. Then `pnpm exec playwright install chromium` stalled in `oopBrowserDownload.js` with no output for about twenty minutes, and I killed it. The cache holds `chromium-1234` but only headless shells 1223, 1243 and 1248, so a full Chromium for the pinned version is there and its headless shell is not. My wait loop, `until ! pgrep -f "playwright (install|test)"`, could never have ended, because its own command line matched the pattern. The kept walks were left to CI's web smoke shard, which passed.

**Why.** Why the shell is missing: not established. Why the download stalled: not established. The pgrep never ending: the pattern matched the loop's own command line.

**Cost.** About 20 minutes of wall-clock, and the plan's local validation was given up for CI's run.

**Prevent by.** The prevention ah-9qdz.2 names still stands: `prewarm` in `.cerebro/project.conf` still runs only `pnpm --filter @atlantis/browser-core build:wasm`, not `pnpm exec playwright install chromium`. Two additions. Give that install a timeout, as ah-mjy asks for the `pwa` job, so a stalled download fails in minutes rather than silently. And write a wait on a process with `pgrep -f '[p]laywright test'` or by its pid, never with a pattern that matches the waiting shell's own command line.

**Seen before.** ah-07tn, ah-9qdz.2 (missing headless shell 1234); ah-mjy (stalled Playwright install, in CI).
