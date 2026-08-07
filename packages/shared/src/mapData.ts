import type { ReportParseResult, UnitSummary } from "@atlantis/core-client";

export type HexCoordinate = {
  col: number;
  row: number;
};

export type MapRegionNode = {
  regionId: string;
  name: string;
  coordinate: HexCoordinate;
  units: UnitSummary[];
};

export type MapViewModel = {
  regions: MapRegionNode[];
  initialSelectedRegionId: string | null;
};

const REGION_ID_PATTERN = /^([A-Za-z]+)(\d+)$/u;

function parseLettersToColumn(letters: string): number {
  let value = 0;
  for (const letter of letters.toUpperCase()) {
    value = value * 26 + (letter.charCodeAt(0) - 64);
  }
  return value - 1;
}

export function parseRegionCoordinate(regionId: string): HexCoordinate | null {
  const match = REGION_ID_PATTERN.exec(regionId.trim());
  if (!match) {
    return null;
  }

  const letters = match[1];
  const rowNumber = Number.parseInt(match[2] ?? "", 10);
  if (!letters || !Number.isFinite(rowNumber) || rowNumber < 1) {
    return null;
  }

  return {
    col: parseLettersToColumn(letters),
    row: rowNumber - 1
  };
}

function compareCoordinates(left: HexCoordinate, right: HexCoordinate): number {
  if (left.row !== right.row) {
    return left.row - right.row;
  }
  return left.col - right.col;
}

function fallbackCoordinate(startRow: number, index: number): HexCoordinate {
  const columns = 8;
  return {
    col: index % columns,
    row: startRow + Math.floor(index / columns)
  };
}

export function buildMapViewModel(parseResult: ReportParseResult): MapViewModel {
  const unitsByRegion = new Map<string, UnitSummary[]>();
  parseResult.units.forEach((unit) => {
    const current = unitsByRegion.get(unit.regionId) ?? [];
    current.push(unit);
    unitsByRegion.set(unit.regionId, current);
  });

  const coordinateRegions: Array<{ regionId: string; name: string; coordinate: HexCoordinate }> = [];
  const fallbackRegions: Array<{ regionId: string; name: string }> = [];

  parseResult.regions.forEach((region) => {
    const coordinate = parseRegionCoordinate(region.regionId);
    if (coordinate) {
      coordinateRegions.push({
        regionId: region.regionId,
        name: region.name,
        coordinate
      });
      return;
    }

    fallbackRegions.push({
      regionId: region.regionId,
      name: region.name
    });
  });

  coordinateRegions.sort((left, right) => {
    const byCoordinate = compareCoordinates(left.coordinate, right.coordinate);
    if (byCoordinate !== 0) {
      return byCoordinate;
    }
    return left.regionId.localeCompare(right.regionId);
  });

  fallbackRegions.sort((left, right) => left.regionId.localeCompare(right.regionId));
  const fallbackStartRow =
    coordinateRegions.reduce((maxRow, region) => Math.max(maxRow, region.coordinate.row), -1) + 2;

  const regions = [
    ...coordinateRegions.map((region) => ({
      regionId: region.regionId,
      name: region.name,
      coordinate: region.coordinate,
      units: [...(unitsByRegion.get(region.regionId) ?? [])].sort((left, right) => left.name.localeCompare(right.name))
    })),
    ...fallbackRegions.map((region, index) => ({
      regionId: region.regionId,
      name: region.name,
      coordinate: fallbackCoordinate(fallbackStartRow, index),
      units: [...(unitsByRegion.get(region.regionId) ?? [])].sort((left, right) => left.name.localeCompare(right.name))
    }))
  ];

  return {
    regions,
    initialSelectedRegionId: regions[0]?.regionId ?? null
  };
}
