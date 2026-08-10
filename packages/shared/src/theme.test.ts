import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The light theme is a parallel set of `--color-*` overrides under `:root[data-theme="light"]`.
 * Tailwind compiles utilities to `var()` references, so a token that exists in the dark
 * `@theme` block but not in the light block silently keeps its dark value in light mode —
 * no error anywhere. This guard turns that silence into a failure whenever a token is added.
 */
const css = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8");

function colorTokens(block: string): string[] {
  return [...block.matchAll(/--color-[\w-]+(?=\s*:)/g)].map((match) => match[0]);
}

function extractBlock(source: string, opener: RegExp): string {
  const start = source.search(opener);
  if (start < 0) {
    return "";
  }
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, i);
      }
    }
  }
  return "";
}

describe("theme palette", () => {
  it("keeps every colour in the token system: no hex literals in components", async () => {
    // A hard-coded colour is invisible to the light theme: it neither fails the parity test above
    // nor follows `data-theme`, it just renders wrong in one of the two modes. All colour goes
    // through `--color-*` tokens, so components must never name a hex value directly.
    const { readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = fileURLToPath(new URL(".", import.meta.url));
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(path);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
          if (/#[0-9a-fA-F]{6}\b/.test(readFileSync(path, "utf8"))) {
            // The path relative to src/, so a failure names the offending file unambiguously.
            offenders.push(path.slice(root.length));
          }
        }
      }
    };
    visit(root);
    expect(offenders).toEqual([]);
  });

  it("gives every dark token a light counterpart", () => {
    const darkTokens = colorTokens(extractBlock(css, /@theme\b/));
    expect(darkTokens.length).toBeGreaterThan(0);

    const lightBlock = extractBlock(css, /:root\[data-theme="light"\]/);
    const lightTokens = new Set(colorTokens(lightBlock));

    const missing = darkTokens.filter((token) => !lightTokens.has(token));
    expect(missing).toEqual([]);
  });
});
