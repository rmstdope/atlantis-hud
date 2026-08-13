import { describe, expect, it } from "vitest";
import { DEFAULT_PORT_BASE, PORTS_PER_AGENT, portsFrom } from "./smokePorts";

/**
 * Which ports a browser-suite run serves on.
 *
 * Fixed ports are why two agents cannot run the suites at once, and the way they fail is the
 * dangerous part rather than the inconvenient one. The smoke config passes `--strictPort`, so a
 * collision there is loud. The PWA config did not: a second Vite quietly took the next free port
 * while Playwright's readiness probe hit the configured one and found the *first* agent's server -
 * so every PWA test ran against somebody else's bundle and passed.
 *
 * The base is per agent and comes from the environment. It defaults to today's numbers, so a plain
 * local run is unchanged and nobody has to know this exists.
 */
describe("portsFrom", () => {
  it("defaults to the ports this repository has always used", () => {
    expect(portsFrom(undefined)).toEqual({ web: 4173, desktop: 4174, pwa: 4175 });
    expect(DEFAULT_PORT_BASE).toBe(4173);
  });

  it("treats an empty or blank value as no preference at all", () => {
    // An exported-but-empty variable is the ordinary shape of "unset" in a shell, and answering it
    // with a throw would break a plain run for someone who has the variable in their profile.
    expect(portsFrom("")).toEqual(portsFrom(undefined));
    expect(portsFrom("   ")).toEqual(portsFrom(undefined));
  });

  it("moves all three suites together, so one agent owns one block", () => {
    expect(portsFrom("4200")).toEqual({ web: 4200, desktop: 4201, pwa: 4202 });
  });

  it("keeps a block wide enough that neighbouring agents cannot overlap", () => {
    const first = portsFrom(String(DEFAULT_PORT_BASE));
    const second = portsFrom(String(DEFAULT_PORT_BASE + PORTS_PER_AGENT));
    const used = Object.values(first);

    expect(PORTS_PER_AGENT).toBeGreaterThanOrEqual(3);
    expect(used).not.toContain(second.web);
    expect(used).not.toContain(second.desktop);
    expect(used).not.toContain(second.pwa);
  });

  it("refuses a base that is not a whole number, rather than falling back to the default", () => {
    // Falling back would be the friendly answer and the wrong one: a typo'd base would silently
    // put this agent back onto the shared ports, which is the collision being avoided.
    expect(() => portsFrom("no")).toThrow(/SMOKE_PORT_BASE/u);
    expect(() => portsFrom("4200.5")).toThrow(/SMOKE_PORT_BASE/u);
  });

  it("refuses anything that is not plain decimal digits, however numeric it may be", () => {
    // `Number` is happy to read "1e3" as 1000 and "0x10" as 16, both of which are whole numbers and
    // neither of which is a port somebody typed on purpose. A base is digits or it is a mistake.
    expect(() => portsFrom("1e3")).toThrow(/SMOKE_PORT_BASE/u);
    expect(() => portsFrom("0x1075")).toThrow(/SMOKE_PORT_BASE/u);
    expect(() => portsFrom("0b1000001001101")).toThrow(/SMOKE_PORT_BASE/u);
    expect(() => portsFrom("+4173")).toThrow(/SMOKE_PORT_BASE/u);
  });

  it("refuses a base that would run past the end of the port range", () => {
    expect(() => portsFrom("70000")).toThrow(/SMOKE_PORT_BASE/u);
    expect(() => portsFrom("80")).toThrow(/SMOKE_PORT_BASE/u);
  });
});
