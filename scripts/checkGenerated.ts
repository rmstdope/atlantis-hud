/**
 * `cargo test` rewrites the generated directories from the Rust types. If that left the
 * tree dirty, the committed bindings were stale — or new ones were never added — and typecheck
 * ran against the wrong shape. Fails with the list of files, so the fix is `git add`.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GENERATED_DIRS = [
  "packages/core-client/src/generated",
  "packages/ruleset/src/generated"
];

export function staleFiles(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3));
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const status = execFileSync("git", ["status", "--porcelain", "--", ...GENERATED_DIRS], {
    encoding: "utf8"
  });
  const stale = staleFiles(status);
  if (stale.length > 0) {
    process.stderr.write(
      `generated TypeScript bindings differ from the Rust types (cargo test rewrote them):\n  ${stale.join("\n  ")}\ncommit the rewritten files.\n`
    );
    process.exit(1);
  }
}
