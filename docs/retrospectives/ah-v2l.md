# ah-v2l — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-16
- **PR:** #310

## The plan's `import.meta.url` design for `@atlantis/fixtures` broke the Playwright smoke suite

**What happened.** The plan specified resolving a fixture's path with
`fileURLToPath(new URL(..., import.meta.url))`, asserting "`import.meta.url` under vitest and under
Playwright both point at the source file, so `reportPath` resolves the same way in both". Built and
typechecked fine, but `pnpm run test:smoke` failed every spec that imported `@atlantis/fixtures` with
`SyntaxError: Cannot use 'import.meta' outside a module` — the error surfaced at the *spec file's*
own first line, not inside the package, because Playwright's TS transform parses each required file
as a single script and does not support `import.meta` syntax appearing anywhere in that require
graph, regardless of the importing package's own `"type"` field.

**Why.** `tests/native/sweep.ts` already avoided this — its own comment said "only `node:fs`/
`node:path` for the fixtures", i.e. `__dirname`-based resolution, deliberately, for the same reason.
The plan's claim about `import.meta.url` was verified against vitest and against Node's ESM loader in
isolation, not against Playwright's actual spec transform, which is CommonJS-shaped irrespective of
package.json `"type"`.

**Cost.** One full local `pnpm run test:smoke` run (about 6 minutes) to discover the failure, plus a
rewrite of `packages/fixtures/src/index.ts` from `import.meta.url`/`fileURLToPath` to `__dirname`/
`join`, dropping `"type": "module"` from its `package.json` to match. No CI cycle was spent on it —
caught locally before the PR opened.

**Prevent by.** When a plan specifies a new package meant to be `require()`d from a Playwright spec
under `tests/smoke/`, verify the path-resolution approach against `tests/native/sweep.ts`'s existing
`__dirname` convention (already there for exactly this reason) rather than against vitest/Node ESM
alone — and run `pnpm run test:smoke` locally before opening the PR whenever the diff adds an import
into that require graph, not only when a smoke/pwa regression is otherwise suspected.

**Seen before.** None found.
