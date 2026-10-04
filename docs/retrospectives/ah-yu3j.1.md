# ah-yu3j.1 — retrospective

## The regenerate command `committed.test.ts` prints cannot regenerate a committed ruleset as it stands

**What happened.** Adding one field to the ruleset (`terrainResourceChances`) meant regenerating the three committed rulesets. The command `committed.test.ts` prints as the remedy (`pnpm --filter @atlantis/ruleset scrape -- --rules tests/fixtures/... --out config/public/...`) failed for all three worlds with the usage message: `pnpm --filter` runs the script from `packages/ruleset`, so the repository-relative paths it prints do not resolve. With absolute paths it ran, but it wrote `source.rulesUrl` and `source.dataUrl` as absolute paths of my worktree and stamped a new `fetchedAt`, so following it would have committed machine-specific paths and a false fetch date into every ruleset. I spliced only the new field into each committed file with `jq` instead. `committed.test.ts` and `atlantis verify` both passed on that.

**Why.** The printed command was written for a run from the repository root without `--filter`, and the CLI takes `source` from its arguments and the clock. The test compares against the committed `source`, so a regeneration that rewrites it still passes. The test never shows the problem; only the diff does.

**Cost.** About ten minutes and three failed runs, plus the risk of a noisy diff of absolute paths across three files if the output had been committed as written.

**Prevent by.** Make the remedy line in `packages/ruleset/src/committed.test.ts` runnable from the repository root (`pnpm exec tsx packages/ruleset/src/cli.ts ...`, or `--rules "$PWD/..."`). Also add a CLI flag (for example `--keep-source <committed ruleset>`) that carries the committed file's `source` block forward, so a scraper change regenerates only the scraped content. `pnpm run atlantis refresh` re-fetches over the network, so it does not fill this gap.

**Seen before.** Not in `docs/retrospectives/`. `ah-1wcw.3` and `ah-moq3` record a different regeneration trap (uncommitted ts-rs bindings).
