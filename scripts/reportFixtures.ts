import { readdirSync } from "node:fs";

/**
 * What a committed report fixture is named: ruleset, ruleset version, game, faction and turn, so a
 * test can select one without opening it.
 *
 * The game matters because a faction id is only unique within one game - faction 42 exists in both
 * game 2 and game 3 of the source archive, so a name without the game is ambiguous today, not
 * hypothetically.
 */
export const FIXTURE_NAME = /^([a-z]+)-(\d+\.\d+\.\d+)-g(\d+)-f(\d+)-t(\d+)\.rep$/;

export type ParsedFixtureName = {
  ruleset: string;
  version: string;
  game: string;
  faction: string;
  turn: string;
};

/** Parses a fixture's filename, or `null` when it does not match the naming rule. */
export function parseFixtureName(name: string): ParsedFixtureName | null {
  const match = FIXTURE_NAME.exec(name);
  if (!match) {
    return null;
  }
  const [, ruleset, version, game, faction, turn] = match;
  return { ruleset, version, game, faction, turn };
}

/** Every `.rep` file directly inside `directory`. */
export function fixtureFiles(directory: string): string[] {
  return readdirSync(directory).filter((name) => name.endsWith(".rep"));
}

/**
 * The quoted value on a `#atlantis <id> "..."` line, or `null` when the fixture carries no such
 * line at all.
 *
 * Only the value is returned, never the surrounding line: a caller that logged the line on failure
 * would put a real password into CI output, which is the accident this exists to prevent.
 *
 * Checks only the first such line. Every fixture committed so far has at most one - a report is one
 * faction's own turn - so this is not a gap yet; a fixture built by concatenating more than one
 * faction's report would need this widened to check every occurrence.
 */
export function passwordValue(text: string): string | null {
  const match = /^#atlantis\s+\S+\s+"([^"]*)"/m.exec(text);
  return match ? match[1] : null;
}

/** The key that makes two fixtures duplicates of each other: same game, faction and turn. */
export function duplicateKey(parsed: ParsedFixtureName): string {
  return `g${parsed.game}-f${parsed.faction}-t${parsed.turn}`;
}
