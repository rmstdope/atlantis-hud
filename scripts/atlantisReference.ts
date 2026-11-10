/**
 * A world's rules and data pages, rendered once at scrape time into the reference file the desktop
 * shell serves an assistant (ah-a97xg.8). Pure: `scripts/atlantis.ts` reads the fixtures and writes
 * the file.
 *
 * Rendered here rather than in the shell because the rendering is the scraper's: the rules page is
 * split with `atlantisLookup`, and a New Age world's catalogue is a JSON database only the
 * `@atlantis/ruleset` package converts - which `@atlantis/shared` deliberately does not depend on.
 * So the shell only ever reads plain text out of JSON.
 */

import { catalogueDataPage, preformattedText, type ScrapedWorld } from "@atlantis/ruleset";
import {
  dataEntries,
  type DataEntry,
  type DataSection,
  renderDataEntries,
  rulesAnchors,
  rulesProvenance,
  rulesSection
} from "./atlantisLookup";

export type RulesReferenceSection = { anchor: string; title: string; text: string };

export type RulesReferenceEntry = { section: DataSection; name: string; tag: string | null; text: string };

/** The shape `packages/shared/src/assistant/rulesReference.ts` reads; the two are kept in step by its test of a committed file. */
export type RulesReference = {
  worldId: string;
  label: string;
  rulesUrl: string;
  catalogueUrl: string;
  /** The committed ruleset's `source.fetchedAt`: when these pages were fetched. */
  fetchedAt: string;
  edition: string | null;
  lastChange: string | null;
  sections: RulesReferenceSection[];
  data: RulesReferenceEntry[];
};

const TITLE_LENGTH = 80;

/** A section's first non-blank line, as the page writes its heading. */
function titleOf(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim() !== "") ?? "";
  return line.trim().replace(/\s+/g, " ").slice(0, TITLE_LENGTH);
}

/** One entry per section and name, its levels rendered together the way `atlantis data` prints them. */
function groupedEntries(entries: DataEntry[]): RulesReferenceEntry[] {
  const groups = new Map<string, DataEntry[]>();
  for (const entry of entries) {
    const key = `${entry.section}\u0000${entry.name}`;
    const group = groups.get(key);
    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  return [...groups.values()].map((group) => {
    const [first] = group as [DataEntry, ...DataEntry[]];
    return { section: first.section, name: first.name, tag: first.tag, text: renderDataEntries(group) };
  });
}

/** `catalogue` as served: an HTML data page, or a New Age JSON database. */
export function buildRulesReference(
  world: ScrapedWorld,
  rulesHtml: string,
  catalogue: string,
  fetchedAt: string
): RulesReference {
  const { edition, lastChange } = rulesProvenance(rulesHtml);
  const sections = rulesAnchors(rulesHtml).map((anchor) => {
    const text = rulesSection(rulesHtml, anchor) ?? "";
    return { anchor, title: titleOf(text), text };
  });
  const data = groupedEntries(dataEntries(preformattedText(catalogueDataPage(world.catalogueSource, catalogue))));
  return {
    worldId: world.id,
    label: world.label,
    rulesUrl: world.rulesUrl,
    catalogueUrl: world.catalogueUrl,
    fetchedAt,
    edition,
    lastChange,
    sections,
    data
  };
}

export function referenceFileText(reference: RulesReference): string {
  return `${JSON.stringify(reference, null, 2)}\n`;
}
