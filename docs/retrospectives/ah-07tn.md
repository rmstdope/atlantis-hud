# ah-07tn — retrospective

- **Bead:** ah-07tn (Enter on a word that ends the order opens the next line)
- **PR:** #1389

## A local smoke run failed every walk because this machine had no Playwright browser

**What happened.** The first local run of `tests/smoke/completion-popup.spec.ts` (through
`smoke-port`) failed all 14 walks, including the six pre-existing ones that main passes, with
`browserType.launch: Executable doesn't exist at ~/Library/Caches/ms-playwright/chromium_headless_shell-1234/...`.
The web bundle had built fine; only the browser was missing. `pnpm exec playwright install chromium`
downloaded it (95 MB) and the re-run passed 14/14.

**Why.** Not established. The repository's resolved Playwright wants headless shell 1234 and the cache
had none. ah-d00t's retrospective recommends deleting stale `ms-playwright/chromium*` directories to
reclaim disk; a prune that took the current version too would leave exactly this.

**Cost.** One wasted smoke run (bundle build plus 14 failing walks with retries, a few minutes), and
the walk's RED could not be observed before the wiring went in.

**Prevent by.** `.cerebro/project.conf`'s `prewarm` (today only `build:wasm`) could also run
`pnpm exec playwright install chromium`, which is a no-op when the browser is present; or the smoke
gate could check for the executable first and say "run playwright install" rather than failing every
walk with a launch error.

**Seen before.** Not this failure. Related: ah-d00t (pruning the Playwright browser cache for disk).
