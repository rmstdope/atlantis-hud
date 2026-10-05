/**
 * What a game's reports name that a ruleset does not define (ah-gicw).
 *
 * A ruleset is the scraped game data the app reads every report against. A report written under
 * one ruleset and read under another names things the second has no entry for: those show without
 * their game data. This module answers which, so the player is warned before they change rulesets.
 * ah-fdmb's report-open warning asks the same question of a single report.
 *
 * Pure on purpose: the settings control and the shell feed it parsed reports and parsed rulesets,
 * and nothing here touches storage or React.
 */
import type { ParsedReport } from "@atlantis/core-client";
import {
  itemEntryId,
  skillEntryId,
  structureEntryId,
  terrainEntryId,
  type GameDataIndex
} from "./gameData";

/** The five kinds checked, the same set as ah-fdmb's report warning. */
export type GapKind = "item" | "skill" | "structure" | "race" | "terrain";

/** The order the groups always come in. */
export const GAP_KIND_ORDER: readonly GapKind[] = ["item", "skill", "structure", "race", "terrain"];

/** Each group's heading, before its count. */
export const GAP_KIND_LABELS: Readonly<Record<GapKind, string>> = {
  item: "Items",
  skill: "Skills",
  structure: "Buildings and ships",
  race: "Races",
  terrain: "Terrains"
};

/** One name a report uses. `key` is what makes two mentions the same name. */
export type ReportName = { kind: GapKind; key: string; name: string };

export type RulesetGaps = {
  /** Distinct turn numbers checked. */
  totalTurns: number;
  /** Distinct turn numbers naming at least one undefined thing, ascending. */
  affectedTurns: number[];
  /** Non-empty groups, in `GAP_KIND_ORDER`, each name once and alphabetical. */
  groups: { kind: GapKind; names: string[] }[];
  /** How many distinct names, across every group. */
  count: number;
};

/** A ruleset's own name for an item tag, from the first shipped ruleset that has one. */
function knownItem(known: readonly GameDataIndex[], tag: string): { name: string; race: boolean } | null {
  for (const index of known) {
    const id = itemEntryId(index, tag);
    if (id !== null) {
      const entry = index.byId.get(id);
      return { name: entry?.name ?? tag, race: id.startsWith("man:") };
    }
  }
  return null;
}

/**
 * Every name a report contains, in no particular order and with repeats.
 *
 * `known` is every ruleset this build ships. It settles whether a tag is a race or an item, which
 * the report itself does not say, and gives a tag its singular name. A tag none of them knows is an
 * item, in the report's own spelling.
 *
 * Not checked: the region's peasant `race`, a plural word with no tag that cannot be matched
 * reliably, though any race recruitable there is tagged in its market; and the skill reports
 * section, which is not in the report type, and whose skills are on the unit that learned them.
 */
export function reportNames(report: ParsedReport, known: readonly GameDataIndex[]): ReportName[] {
  const names: ReportName[] = [];
  const tagged = (tag: string, spelling: string) => {
    const key = tag.toUpperCase();
    const found = knownItem(known, key);
    names.push({ kind: found?.race ? "race" : "item", key, name: found?.name ?? spelling });
  };

  for (const region of report.regions) {
    names.push({ kind: "terrain", key: terrainEntryId(region.terrain), name: region.terrain.trim() });
    for (const item of [...region.products, ...region.wanted, ...region.forSale]) {
      tagged(item.tag, item.name);
    }
    for (const structure of region.structures) {
      // A fleet is named by its vessels; "Fleet" itself is neither a building nor a ship.
      const isFleet = structure.baseKind.trim().toLowerCase() === "fleet";
      const kinds = [
        ...(isFleet && structure.vessels.length > 0 ? [] : [structure.baseKind]),
        ...structure.vessels.map((vessel) => vessel.name)
      ];
      for (const kind of kinds) {
        names.push({ kind: "structure", key: kind.trim().toUpperCase(), name: kind.trim() });
      }
    }
    for (const unit of region.units) {
      for (const item of [...unit.items, ...unit.menByRace]) {
        tagged(item.tag, item.name);
      }
      for (const skill of [...unit.skills, ...(unit.combatSpell ? [unit.combatSpell] : [])]) {
        const key = skill.tag.toUpperCase();
        names.push({ kind: "skill", key, name: skill.name });
      }
    }
  }
  return names;
}

/** Whether `target` has an entry for the name. */
function defines(target: GameDataIndex, name: ReportName): boolean {
  switch (name.kind) {
    case "item":
    case "race":
      return itemEntryId(target, name.key) !== null;
    case "skill":
      return target.byId.has(skillEntryId(name.key));
    case "structure":
      return target.byId.has(structureEntryId(target, name.name));
    case "terrain":
      return target.byId.has(name.key);
  }
}

/** What `turns` name that `target` does not define, ready to word. */
export function rulesetGaps(
  turns: readonly { turnNumber: number; report: ParsedReport }[],
  target: GameDataIndex,
  known: readonly GameDataIndex[]
): RulesetGaps {
  const allTurns = new Set<number>();
  const affected = new Set<number>();
  const missing = new Map<GapKind, Map<string, string>>();

  for (const { turnNumber, report } of turns) {
    allTurns.add(turnNumber);
    for (const name of reportNames(report, known)) {
      if (defines(target, name)) {
        continue;
      }
      affected.add(turnNumber);
      const group = missing.get(name.kind) ?? new Map<string, string>();
      if (!group.has(name.key)) {
        group.set(name.key, name.name);
      }
      missing.set(name.kind, group);
    }
  }

  const groups = GAP_KIND_ORDER.flatMap((kind) => {
    const group = missing.get(kind);
    if (!group || group.size === 0) {
      return [];
    }
    const names = [...group.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    return [{ kind, names }];
  });

  return {
    totalTurns: allTurns.size,
    affectedTurns: [...affected].sort((a, b) => a - b),
    groups,
    count: groups.reduce((sum, group) => sum + group.names.length, 0)
  };
}

/** The intro sentence, split around the ruleset name the view sets in bold. */
export type BoldSplit = { before: string; ruleset: string; after: string };

export type RulesetChangeWords = {
  title: string;
  intro: BoldSplit;
  turns: string;
  heading: string;
  groups: { heading: string; names: string }[];
};

/** The warning dialog's words, verbatim from the agreed acceptance. */
export function rulesetChangeWords(rulesetLabel: string, gaps: RulesetGaps): RulesetChangeWords {
  const turns = gaps.affectedTurns;
  return {
    title: `⚠ Change to ${rulesetLabel}?`,
    intro: {
      before: `${turns.length} of this game’s ${gaps.totalTurns} turns name ${gaps.count} things the `,
      ruleset: rulesetLabel,
      after: " ruleset doesn’t define. They will show without their game data if you change."
    },
    turns: `${turns.length === 1 ? "Turn" : "Turns"} ${turns.join(", ")}`,
    heading: `Not defined in ${rulesetLabel}`,
    groups: gaps.groups.map((group) => ({
      heading: `${GAP_KIND_LABELS[group.kind]} (${group.names.length})`,
      names: group.names.join(", ")
    }))
  };
}

/** `✓ Changed to <ruleset>.`, split around the bold name. */
export function changedWords(rulesetLabel: string): BoldSplit {
  return { before: "✓ Changed to ", ruleset: rulesetLabel, after: "." };
}

/** `⚠ Changed to <ruleset> — <n> names in this game’s reports are not defined in it.` */
export function changedAnywayWords(rulesetLabel: string, count: number): BoldSplit {
  return {
    before: "⚠ Changed to ",
    ruleset: rulesetLabel,
    after: ` — ${count} names in this game’s reports are not defined in it.`
  };
}

/** `Couldn’t change the ruleset: <reason>. The game is still on <ruleset>.` */
export function changeFailedWords(reason: string, currentLabel: string): string {
  return `Couldn’t change the ruleset: ${reason}. The game is still on ${currentLabel}.`;
}
