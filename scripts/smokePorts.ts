/**
 * Which ports the browser suites serve on, so two agents can run them at once.
 *
 * Several agents work this repository in parallel, each in its own worktree, and the browser suites
 * used to be pinned to 4173, 4174 and 4175 for all of them. The smoke config passes `--strictPort`,
 * so a collision there at least fails loudly. The PWA config did not: a second `vite preview` took
 * the next free port without comment while Playwright's readiness probe hit the configured one and
 * found the *first* agent's server still answering. Every PWA test then ran against somebody else's
 * bundle, and passed - a green run that proved nothing about the code under test.
 *
 * So the ports come from a base that each agent sets for itself, and every server that derives one
 * also passes `--strictPort`: with distinct blocks a collision should be impossible, and if one
 * happens anyway it must stop the run rather than quietly test the wrong thing.
 *
 * Unset, the base is what it always was, so a plain local run is unchanged and nobody needs to know
 * any of this.
 */

/** The variable an agent sets to claim a block of ports. */
export const PORT_BASE_VARIABLE = "SMOKE_PORT_BASE";

/** What the base is when nobody says otherwise: the ports this repository has always used. */
export const DEFAULT_PORT_BASE = 4173;

/**
 * How far apart two agents' bases must be.
 *
 * Three ports are in use, and the gap is wider so the blocks read as blocks - 4173, 4183, 4193 -
 * and so a fourth server can be added later without renumbering anybody.
 */
export const PORTS_PER_AGENT = 10;

/** The lowest base worth allowing: below 1024 needs privileges, and the low thousands are busy. */
const LOWEST_BASE = 1024;

export type SmokePorts = {
  web: number;
  desktop: number;
  pwa: number;
};

/**
 * The three ports for a run, from the raw environment value.
 *
 * Garbage throws rather than falling back. Falling back would be the friendly answer and the wrong
 * one: a mistyped base would put this agent quietly back onto the shared ports, which is the exact
 * collision the variable exists to avoid.
 */
export function portsFrom(base: string | undefined): SmokePorts {
  const wanted = base?.trim() ? Number(base) : DEFAULT_PORT_BASE;

  if (!Number.isInteger(wanted)) {
    throw new Error(`${PORT_BASE_VARIABLE} is "${base}", which is not a whole number.`);
  }
  if (wanted < LOWEST_BASE || wanted + PORTS_PER_AGENT > 65_535) {
    throw new Error(
      `${PORT_BASE_VARIABLE} is "${base}", which is outside ${LOWEST_BASE}..${65_535 - PORTS_PER_AGENT}.`
    );
  }

  return { web: wanted, desktop: wanted + 1, pwa: wanted + 2 };
}

/** The ports this process should use, read from the environment. */
export function smokePorts(): SmokePorts {
  return portsFrom(process.env[PORT_BASE_VARIABLE]);
}
