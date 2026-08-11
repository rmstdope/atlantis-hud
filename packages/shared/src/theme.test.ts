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

/**
 * Each map theme ships its own stylesheet, holding the colours that theme alone uses and its
 * zoom-band policy. The same parity trap applies there and for the same reason: a custom property
 * declared on `:root` but not under `:root[data-theme="light"]` silently keeps its dark value in
 * light mode, which for a theme built on parchment or bevels is the difference between looking
 * intentional and looking broken.
 */
describe("map theme stylesheets", () => {
  /**
   * Comments are stripped before anything is matched. Every one of these files opens with a header
   * comment that mentions `:root` and the import path by way of explaining them, and a scan over
   * the raw text finds those mentions first - so the checks below would pass on a stylesheet that
   * declared nothing and on an import nobody had written.
   */
  const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

  const themeSheets = async () => {
    const { readdirSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = fileURLToPath(new URL("./workspace/mapThemes", import.meta.url));
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        theme: entry.name,
        path: join(root, entry.name, "theme.css"),
        exists: existsSync(join(root, entry.name, "theme.css"))
      }))
      .map((sheet) => ({
        ...sheet,
        source: sheet.exists ? withoutComments(readFileSync(sheet.path, "utf8")) : ""
      }));
  };

  it("gives every theme a stylesheet of its own", async () => {
    // Filtering the missing ones out instead would quietly excuse a theme that has none, and its
    // zoom-band policy - which is CSS and only CSS - would simply never apply.
    const sheets = await themeSheets();

    expect(sheets.length).toBeGreaterThan(0);
    expect(sheets.filter((sheet) => !sheet.exists).map((sheet) => sheet.theme)).toEqual([]);
  });

  it("gives every theme's own custom property a light counterpart", async () => {
    // Any custom property, not only `--color-*`: a theme names its tokens as it likes.
    const properties = (block: string) => [...block.matchAll(/--[\w-]+(?=\s*:)/g)].map((m) => m[0]);

    for (const sheet of await themeSheets()) {
      const dark = properties(extractBlock(sheet.source, /:root(?!\[)/));
      const light = new Set(properties(extractBlock(sheet.source, /:root\[data-theme="light"\]/)));

      expect({ theme: sheet.theme, missing: dark.filter((token) => !light.has(token)) }).toEqual({
        theme: sheet.theme,
        missing: []
      });
    }
  });

  it("keeps every theme's stylesheet reachable from the app's own", async () => {
    // A theme whose CSS nobody imports renders unstyled, and nothing else would say so.
    const imported = withoutComments(css);

    for (const sheet of await themeSheets()) {
      expect(imported).toContain(`mapThemes/${sheet.theme}/theme.css`);
    }
  });
});
