/**
 * What a Playwright config decides about the servers it starts, read out of the config's own text.
 *
 * Text rather than an import, deliberately. Under `tsx` a dynamic import of `playwright.config.ts`
 * comes back double-wrapped (`m.default.default.webServer`), so an import-based assertion is a bet
 * on module interop as much as on the policy. The policy is three sentences long and lives in the
 * source as literals; reading them is honest and cannot be broken by a loader.
 */

export interface ServerPolicy {
  /** Does any decision in this file depend on `process.env.CI`? It must not — see below. */
  readsCi: boolean;
  /** The right-hand side of every `reuseExistingServer:` in the file, in order. */
  reuseSettings: string[];
  /** How many `vite preview` commands do NOT pass `--strictPort`. */
  previewCommandsWithoutStrictPort: number;
}

/**
 * `CI` must decide nothing here.
 *
 * It said "never reuse a server I did not start" indirectly, and the fleet paid for the indirection
 * twice: three sightings of a suite answering from another checkout's server, and a machine-wide
 * gate lock (`scripts/withGateLock.ts`) that every agent silently switched off by exporting `CI=1`
 * to get this behaviour. One variable cannot mean both "I have the machine to myself" and "do not
 * reuse a running server"; the second is now said outright.
 */
export function serverPolicy(source: string): ServerPolicy {
  // Comments first, and this is not tidiness: `readsCi` is a claim about what the config DECIDES,
  // and the configs explain in prose exactly why they no longer read `CI` — so a search over the
  // raw text reads the explanation as the offence it describes.
  const code = withoutComments(source);

  const reuseSettings = [...code.matchAll(/reuseExistingServer:\s*([^,\n}]+)/g)].map((m) =>
    m[1].trim()
  );

  // `command:` and its template literal, not any prose mentioning `vite preview` — both configs
  // explain the flag in a comment right above the command it belongs to, and a search over the
  // whole text counts the explanation as a violation.
  const previewCommands = [...code.matchAll(/command:\s*`([^`]*)`/g)]
    .map((m) => m[1])
    .filter((command) => command.includes("vite preview"));

  return {
    readsCi: /process\.env\.CI\b/.test(code),
    reuseSettings,
    previewCommandsWithoutStrictPort: previewCommands.filter(
      (command) => !command.includes("--strictPort")
    ).length
  };
}

/** The source with `/* … *\/` and `// …` removed, so prose is never read as code. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}
