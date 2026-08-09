/**
 * Remembering the map across turns.
 *
 * The workspace had no project concept at all: it parsed a report and drew it, and everything the
 * faction had seen in earlier turns stayed on disk unread. That is why the map stopped at the fringe
 * of the current report, and why no route could be longer than one step - a report describes its
 * neighbours but not theirs.
 *
 * This is deliberately a plain module rather than something the component does inline, so the parts
 * that can go wrong - a project that will not open, an import that will not commit - are testable
 * without rendering anything.
 */

import type { CoreClient, ParsedReport, RememberedRegion } from "@atlantis/core-client";
import type { StoredRegion } from "./hexMapModel";

/**
 * Where a faction's project lives.
 *
 * One project per faction, named after it. The player never chose a path and should not have to:
 * a report names its own faction, which is enough to know which project it belongs to.
 */
export function projectPathFor(factionId: string): string {
  return `atlantis-hud/faction-${factionId}.atlantis-project.json`;
}

/** The identity a project is addressed by, once it is open. */
export type OpenProject = {
  projectFilePath: string;
  databasePath: string;
  projectId: string;
  factionId: string;
};

/**
 * Opens the project for a faction, creating it the first time.
 *
 * Opening is tried first because it is the common case; only a project that is not there yet is
 * created. Both are ordinary outcomes, so neither is reported as an error.
 */
export async function openOrCreateProject(
  client: CoreClient,
  factionId: string,
  factionName: string
): Promise<OpenProject> {
  const projectFilePath = projectPathFor(factionId);
  const projectId = `faction-${factionId}`;

  const opened = await client.openProject(projectFilePath).catch(() => null);
  const project =
    opened ??
    (await client.createProject(projectFilePath, {
      manifestVersion: 1,
      metadata: { projectId, projectName: factionName },
      reportSources: []
    }));

  return {
    projectFilePath: project.projectFilePath,
    databasePath: project.databasePath,
    projectId,
    factionId
  };
}

/**
 * Turns what the core remembers into what the map wants.
 *
 * The two disagree on shape rather than on content: the core keeps whole regions with the turn they
 * were seen in, and the map wants them flattened alongside a coordinate it can key on.
 */
export function toStoredRegions(remembered: RememberedRegion[]): StoredRegion[] {
  return remembered.map((entry) => ({
    regionId: entry.region.regionId,
    coordinate: entry.region.coordinate,
    terrain: entry.region.terrain,
    province: entry.region.province,
    label: `${entry.region.terrain} (${entry.region.coordinate.x},${entry.region.coordinate.y}) in ${entry.region.province}`,
    lastSeenTurn: entry.lastSeenTurn,
    region: entry.region
  }));
}

/** What remembering a turn produced, and anything that went wrong doing it. */
export type MemoryOutcome = {
  project: OpenProject | null;
  /**
   * Everywhere the faction has been, as the core keeps it.
   *
   * Returned in the core's own shape rather than the map's, because both consumers need it: the map
   * wants it flattened, and the planner wants it exactly as it is. Converting here and back again
   * would be the shorter route to handing the planner nothing.
   */
  remembered: RememberedRegion[];
  /** Set when the turn could not be remembered. The report is still perfectly usable without it. */
  warning: string | null;
};

/**
 * Commits a report to the project and reads back everything the faction has ever seen.
 *
 * Failing to remember a turn is a warning rather than an error. The report in front of the player
 * parsed perfectly well, and refusing to show it because a database would not open would be trading
 * something that works for something that does not.
 */
export async function rememberTurn(
  client: CoreClient,
  parsed: ParsedReport,
  rawReport: string
): Promise<MemoryOutcome> {
  const factionId = parsed.header.factionId;
  if (!factionId) {
    return {
      project: null,
      remembered: [],
      warning: "the report does not name its faction, so it cannot be remembered"
    };
  }

  try {
    const project = await openOrCreateProject(
      client,
      factionId,
      parsed.header.factionName ?? `Faction ${factionId}`
    );

    // Overwriting is right here: re-importing the same turn should refresh what is remembered
    // rather than refuse, and the player has already chosen this file.
    await client.commitReportImport(
      project.databasePath,
      project.projectId,
      factionId,
      rawReport,
      true
    );

    const remembered = await client.loadRegionSightings(
      project.databasePath,
      project.projectId,
      factionId
    );

    return { project, remembered, warning: null };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      project: null,
      remembered: [],
      warning: `the turn could not be remembered: ${detail}`
    };
  }
}
