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

  /** Every accent carries meaning, so every one of them is text. */
  const ACCENT_TOKENS = [
    "--color-brass",
    "--color-brass-bright",
    "--color-select",
    "--color-ok",
    "--color-warn",
    "--color-danger",
    "--color-gain"
  ];

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

  /**
   * The floating panes are not opaque: `.bg-pane` paints `--color-panel` at
   * `100 - --pane-transparency` percent over the live map, so the real background of nearly all
   * the app's text is a terrain colour, and it changes as the player pans. The assertion above,
   * against the opaque panel, is a background a reader never sees for a floating pane - and it
   * passed all the way through the eye-strain report that produced ah-v09e. This is the one that
   * would have caught it.
   *
   * Nothing in the app is WCAG "large text" - 14px is the largest size and 500 the heaviest
   * weight - so 4.5:1 is the bar for every one of these. Tundra is the worst terrain for every
   * token, and `select` over it is the tightest pair in the palette.
   *
   * Dark only. Light mode fails this today (dark ink over a light pane on dark terrain is
   * 1.09:1); that is ah-j1xd's scope, and a known-red assertion is worth nothing.
   */
  it("keeps every dark text token readable through a pane over every terrain", () => {
    // From the source rather than hard-coded, so a future change to the default either keeps the
    // app readable or fails here.
    const store = readFileSync(
      fileURLToPath(new URL("./settingsStore.ts", import.meta.url)),
      "utf8"
    );
    const defaultTransparency = Number.parseInt(
      store.match(/DEFAULT_PANE_TRANSPARENCY\s*=\s*(\d+)/)![1],
      10
    );

    const values = tokenValues(extractBlock(css, /@theme\b/));
    // `color-mix(in srgb, panel P%, transparent)` over the terrain, per channel.
    const alpha = (100 - defaultTransparency) / 100;
    const composite = (top: string, bottom: string): string => {
      const mix = [1, 3, 5].map((at) => {
        const t = Number.parseInt(top.slice(at, at + 2), 16);
        const b = Number.parseInt(bottom.slice(at, at + 2), 16);
        return Math.round(t * alpha + b * (1 - alpha));
      });
      return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    };

    const panel = values.get("--color-panel")!;
    const terrains = [...values.keys()].filter((token) => token.startsWith("--color-terrain-"));
    expect(terrains.length).toBeGreaterThan(0);

    const unreadable: string[] = [];
    for (const terrain of terrains) {
      const behind = composite(panel, values.get(terrain)!);
      // Every token text is drawn in, accents included: `select` over tundra is the tightest pair
      // in the whole palette, and it is an accent, not an ink.
      for (const ink of [...INK_TOKENS, ...ACCENT_TOKENS]) {
        const ratio = contrast(values.get(ink)!, behind);
        if (ratio < AA_SMALL_TEXT) {
          unreadable.push(`${ink} through a pane over ${terrain} is ${ratio.toFixed(2)}:1`);
        }
      }
    }

    expect(unreadable).toEqual([]);
  });

  /**
   * A band, not a floor (ah-v09e).
   *
   * Near-white body text on a near-black ground halates: the glyphs bloom into their background
   * and a reader has to work to hold them still, which is the eye strain the report described.
   * The floor above says text must be readable; this says it must not glow either. Discord's dark
   * theme, the reporter's own reference, runs body text at 9.36:1.
   */
  const MAX_BODY_CONTRAST = 12;

  it("keeps dark body text inside a band rather than at maximum contrast", () => {
    const values = tokenValues(extractBlock(css, /@theme\b/));

    const glaring: string[] = [];
    for (const surface of SURFACES) {
      const ratio = contrast(values.get("--color-ink")!, values.get(surface)!);
      if (ratio > MAX_BODY_CONTRAST) {
        glaring.push(`--color-ink on ${surface} is ${ratio.toFixed(2)}:1`);
      }
    }

    expect(glaring).toEqual([]);
  });

  /**
   * Every accent carries meaning - a heading, a warning, an error, a selection - so each is text
   * and each is held to AA on every surface it can be written on.
   *
   * This passes today and must still pass: lifting the surfaces costs every accent about a ratio
   * point, and on `--color-panel-raised` (dialogs, popovers, header chips) the pre-ah-v09e
   * `danger` and `select` fell to 4.01 and 4.46. Fixing eye strain must not introduce two new
   * accessibility failures on the way.
   */

  it("keeps every dark accent above AA on every surface", () => {
    const values = tokenValues(extractBlock(css, /@theme\b/));

    const unreadable: string[] = [];
    for (const accent of ACCENT_TOKENS) {
      for (const surface of SURFACES) {
        const ratio = contrast(values.get(accent)!, values.get(surface)!);
        if (ratio < AA_SMALL_TEXT) {
          unreadable.push(`${accent} on ${surface} is ${ratio.toFixed(2)}:1`);
        }
      }
    }

    expect(unreadable).toEqual([]);
  });

  /**
   * The boxes have to do their own grouping. `--color-edge` sat at 1.27:1 against the panel and
   * `--color-edge-soft` at 1.12:1 - close enough to invisible that the reader's eye was grouping
   * the panes by their contents instead, which is work (ah-v09e).
   *
   * Against `--color-panel` only: both sit lower on `--color-panel-raised` by design, since a
   * lighter surface leaves an edge less room.
   */
  it("keeps dark borders visible against the panel", () => {
    const values = tokenValues(extractBlock(css, /@theme\b/));
    const panel = values.get("--color-panel")!;

    expect(contrast(values.get("--color-edge")!, panel)).toBeGreaterThanOrEqual(1.6);
    expect(contrast(values.get("--color-edge-soft")!, panel)).toBeGreaterThanOrEqual(1.15);
  });

  /**
   * The map's label haloes are the map's decision, not the chrome's (ah-v09e).
   *
   * `.map-label` and `.region-name` used to stroke themselves with `--color-ground` and fill with
   * `--color-ink-soft` - chrome tokens - which made the legibility of every label on the map
   * hostage to a palette change made for the panels. Lifting the chrome's ground for eye strain
   * would have lightened every label's outline with it. They get map-owned tokens instead,
   * holding the values the chrome used to supply, so the rendered map is unchanged.
   */
  it("draws map labels from map-owned tokens, not the chrome palette", () => {
    const mapLabel = extractBlock(css, /\.map-label\b/);
    expect(mapLabel).toMatch(/stroke\s*:\s*var\(--color-map-label-halo\)/);
    expect(mapLabel).not.toMatch(/var\(--color-ground\)/);

    const regionName = extractBlock(css, /\.region-name\b/);
    expect(regionName).toMatch(/stroke\s*:\s*var\(--color-map-label-halo\)/);
    expect(regionName).toMatch(/fill\s*:\s*var\(--color-map-region-name/);
    expect(regionName).not.toMatch(/var\(--color-ground\)/);
    expect(regionName).not.toMatch(/var\(--color-ink-soft/);
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
    // Reaches inside an optional `calc(...)` while still capturing the rem base, so a token
    // wrapped in arithmetic still matches here.
    const sizes = new Map(
      [...themeBlock.matchAll(/(--text-pane[\w-]*)\s*:\s*(?:calc\(\s*)?([\d.]+rem)/g)].map(
        (match) => [match[1], match[2]]
      )
    );

    expect(sizes.get("--text-pane-sm")).toBeDefined();
    expect(sizes.get("--text-pane")).toBeDefined();
    expect(sizes.get("--text-pane-lg")).toBeDefined();

    // rem, not px: a `px` value here would silently recreate the whole bug.
    for (const [token, value] of sizes) {
      expect(value.endsWith("rem"), `${token} is ${value}, not rem`).toBe(true);
    }

    // No token may carry the Interface size multiplier: the root font size carries it for every
    // `rem` in the application (ah-ziv), so a multiplier here would apply the setting twice —
    // 400% type for a 200% setting.
    for (const token of ["--text-pane-sm", "--text-pane", "--text-pane-lg"]) {
      const declared = themeBlock.match(new RegExp(`${token}\\s*:\\s*([^;]+);`))?.[1] ?? "";
      expect(declared, `${token} is ${declared}`).not.toContain("var(--ui-scale");
    }
  });

  it("applies the interface size once, at the root", () => {
    // One multiplier, on the root font size, so every `rem` in the application follows it — type,
    // widths, padding and gaps alike (ah-ziv). `rem` in the root's own `font-size` resolves
    // against the *initial* root size (the reader's own preference), so this is not circular.
    expect(css).toMatch(/font-size\s*:\s*calc\(\s*1rem\s*\*\s*var\(--ui-scale\)\s*\)\s*;/);
  });

  it("starts the pane type scale at 12px", () => {
    // Up one rung (ah-v09e): 11/12/13 asked a reader to focus consciously for an hour-long
    // sitting. Each token takes the next one's old value and a new top is added. `--ui-scale`
    // still multiplies all three, so the Interface size setting reaches them exactly as before.
    const themeBlock = extractBlock(css, /@theme\b/);
    const sizes = new Map(
      [...themeBlock.matchAll(/(--text-pane[\w-]*)\s*:\s*(?:calc\(\s*)?([\d.]+)rem/g)].map(
        (match) => [match[1], match[2]]
      )
    );

    expect(sizes.get("--text-pane-sm")).toBe("0.75");
    expect(sizes.get("--text-pane")).toBe("0.8125");
    expect(sizes.get("--text-pane-lg")).toBe("0.875");
  });

  it("keeps a dialog inside the window", () => {
    // A dialog declares the width its content wants, and at 200% that can be past the edge of the
    // window — taking its Close button with it. The viewport is the last word (ah-ziv, O1). On the
    // role rather than on each component, so a new dialog inherits it.
    // `aria-modal` narrows it to the centred modals; an anchored `PopoverFrame` shares the role
    // but is fluid and out of scope.
    const dialogRule = extractBlock(css, /\[role="dialog"\]\[aria-modal="true"\]/);
    expect(dialogRule).toMatch(/max-width\s*:/);
    expect(dialogRule).toMatch(/max-height\s*:/);
    expect(dialogRule).toMatch(/overflow\s*:/);
  });

  it("declares --ui-scale with a default of 1, outside the @theme block", () => {
    // Somewhere in the stylesheet, the panes must render correctly before `settingsStore` has
    // stamped anything and in any test that mounts a component alone.
    expect(css).toMatch(/--ui-scale\s*:\s*1\s*;/);

    // Not inside `@theme`: that block is Tailwind's utility-generating namespace, and this is not
    // a utility - `--pane-transparency` is the precedent for living in the plain block instead.
    // (A reference like `var(--ui-scale, 1)` is fine there; only a declaration is not.)
    const themeBlock = extractBlock(css, /@theme\b/);
    expect(themeBlock).not.toMatch(/--ui-scale\s*:\s*1\s*;/);
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
