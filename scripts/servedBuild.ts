import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Checks that the page a site serves at `/` is the build just uploaded (ah-gktt).
 *
 * The host answers the manifest and the icons with a proof-of-work challenge that a script cannot
 * pass, so `manifestCheck.ts` can no longer prove the deployment on its own. The page at `/` is not
 * challenged, and Vite names the entry script by content hash, so "the served page loads the entry
 * script this build's `index.html` loads" proves both that the upload landed where the domain serves
 * and that it is this build rather than an older one.
 */

/** The `src` of every module script a page loads, in order. */
export function moduleScripts(html: string): string[] {
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  return tags.flatMap((tag) => {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) return [];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    return src === undefined ? [] : [src];
  });
}

export type BuildVerdict = { ok: true } | { ok: false; message: string };

/** Whether `served` loads every module script `built` loads, with the sentence to log when not. */
export function servesBuild(served: string, built: string): BuildVerdict {
  const expected = moduleScripts(built);
  if (expected.length === 0) {
    return { ok: false, message: "The built index.html loads no module script, so there is nothing to compare." };
  }
  const missing = expected.filter((src) => !moduleScripts(served).includes(src));
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    message: `The page served is not this build - it does not load ${missing.join(", ")}.`
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/** Usage: servedBuild.ts <served page file> <built index.html>. Exits 1 with an `::error::` line. */
function runCli(servedFile: string | undefined, builtFile: string | undefined): void {
  if (servedFile === undefined || builtFile === undefined) {
    process.stdout.write("::error::Usage: servedBuild.ts <served page file> <built index.html>\n");
    process.exitCode = 1;
    return;
  }
  try {
    const verdict = servesBuild(readFileSync(servedFile, "utf8"), readFileSync(builtFile, "utf8"));
    if (!verdict.ok) {
      process.stdout.write(`::error::${verdict.message}\n`);
      process.exitCode = 1;
    }
  } catch (error) {
    process.stdout.write(`::error::The build check itself failed: ${String(error)}\n`);
    process.exitCode = 1;
  }
}

if (invokedDirectly) {
  runCli(process.argv[2], process.argv[3]);
}
