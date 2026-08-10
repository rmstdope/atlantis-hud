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
  it("gives every dark token a light counterpart", () => {
    const darkTokens = colorTokens(extractBlock(css, /@theme\b/));
    expect(darkTokens.length).toBeGreaterThan(0);

    const lightBlock = extractBlock(css, /:root\[data-theme="light"\]/);
    const lightTokens = new Set(colorTokens(lightBlock));

    const missing = darkTokens.filter((token) => !lightTokens.has(token));
    expect(missing).toEqual([]);
  });
});
