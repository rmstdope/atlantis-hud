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

  /**
   * The greys have to be readable, not merely present.
   *
   * `ink-soft` and `ink-dim` carry the small print - field labels, the sentence under a checkbox,
   * a hex's coordinates - and small print is exactly where a colour chosen by eye on one monitor
   * turns into something nobody can read on another. WCAG AA asks 4.5:1 for text this size, and
   * the dark theme's dim grey was at 2.78:1 against a raised panel.
   *
   * Measured against every surface either grey is written on, in both themes.
   */
  const INK_TOKENS = ["--color-ink", "--color-ink-soft", "--color-ink-dim"];
  const SURFACES = ["--color-ground", "--color-panel", "--color-panel-raised"];
  const AA_SMALL_TEXT = 4.5;

  function tokenValues(block: string): Map<string, string> {
    return new Map(
      [...block.matchAll(/(--color-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map((match) => [
        match[1],
        match[2]
      ])
    );
  }

  function relativeLuminance(hex: string): number {
    const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
    const linear = channels.map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    );
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  function contrast(one: string, other: string): number {
    const [brighter, darker] = [relativeLuminance(one), relativeLuminance(other)].sort(
      (a, b) => b - a
    );
    return (brighter + 0.05) / (darker + 0.05);
  }

  it.each([
    ["dark", /@theme\b/],
    ["light", /:root\[data-theme="light"\]/]
  ])("keeps %s grey text readable on every surface it is written on", (_theme, opener) => {
    const values = tokenValues(extractBlock(css, opener));

    const unreadable: string[] = [];
    for (const ink of INK_TOKENS) {
      for (const surface of SURFACES) {
        const ratio = contrast(values.get(ink)!, values.get(surface)!);
        if (ratio < AA_SMALL_TEXT) {
          unreadable.push(`${ink} on ${surface} is ${ratio.toFixed(2)}:1`);
        }
      }
    }

    expect(unreadable).toEqual([]);
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
 * The panes' type scale (ah-46p.1): three named `rem` tokens replace 67 hard-coded `px` sites.
 * `px` ignores the reader's font-size preference outright, so a token is what lets it reach the
 * panes at all.
 */
describe("pane type scale", () => {
  it("declares the pane type scale as rem tokens in the theme block", () => {
    const themeBlock = extractBlock(css, /@theme\b/);
    const sizes = new Map(
      [...themeBlock.matchAll(/(--text-pane[\w-]*)\s*:\s*([\d.]+rem)/g)].map((match) => [
        match[1],
        match[2]
      ])
    );

    expect(sizes.get("--text-pane-sm")).toBeDefined();
    expect(sizes.get("--text-pane")).toBeDefined();
    expect(sizes.get("--text-pane-lg")).toBeDefined();

    // rem, not px: a `px` value here would silently recreate the whole bug.
    for (const [token, value] of sizes) {
      expect(value.endsWith("rem"), `${token} is ${value}, not rem`).toBe(true);
    }
  });

  /**
   * `px` ignores the reader's font-size preference; the three `--text-pane*` tokens are the scale.
   * A new hard-coded `px` size is exactly how 67 of them accumulated in the first place.
   */
  async function sourcesWithAbsoluteType(): Promise<string[]> {
    const { readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = fileURLToPath(new URL(".", import.meta.url));
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(path);
          // Test files are excluded (both `.test.ts` and `.test.tsx`): fixture markup in a test can
          // legitimately use an arbitrary pixel value that has nothing to do with pane type, and
          // this guard is about production sources.
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const contents = readFileSync(path, "utf8");
          if (/text-\[[\d.]+px\]/.test(contents) || /fontSize:\s*["'][\d.]+px["']/.test(contents)) {
            offenders.push(path.slice(root.length));
          }
        }
      }
    };
    visit(root);
    return offenders;
  }

  it("sets no pane type in absolute pixels", async () => {
    expect(await sourcesWithAbsoluteType()).toEqual([]);
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

  it("colours the province border in every theme's own ink", async () => {
    // A theme's directory is its id in camelCase (cartographers-table -> cartographersTable), the
    // same transform `docs/ui/map-themes.md` describes for the folder-to-id relationship.
    const { MAP_THEMES } = await import("./workspace/mapThemes/index");
    const folderNameOf = (id: string) => id.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const sheets = await themeSheets();

    for (const theme of MAP_THEMES) {
      const sheet = sheets.find((candidate) => candidate.theme === folderNameOf(theme.id));

      expect(sheet, `no stylesheet directory for theme "${theme.id}"`).toBeDefined();
      expect(sheet!.source).toContain(`.map-theme-${theme.id} .region-outline`);
      expect(sheet!.source).toContain(`.map-theme-${theme.id} .region-outline-halo`);
    }
  });
});
