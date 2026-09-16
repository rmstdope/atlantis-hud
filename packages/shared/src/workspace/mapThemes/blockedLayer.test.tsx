import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONGESTED_CENTRE } from "./congestedFixture";
import { allBadges, buildHexViews, type HexViewOptions } from "./hexView";
import { BlockedLabels, BlockedRings } from "./blockedLayer";

function views(blocked: Map<string, { regionId: string; label: string; sentences: string[] }>) {
  const options: HexViewOptions = { showStaleness: true, showTextures: false, badges: allBadges(true), blocked };
  const other = { ...CONGESTED_CENTRE, key: "other", regionId: "1:99,99", coordinate: { x: 99, y: 99, z: 1 } };
  return buildHexViews([CONGESTED_CENTRE, other], options);
}

const ONE_BLOCKED = () =>
  views(new Map([[CONGESTED_CENTRE.regionId, { regionId: CONGESTED_CENTRE.regionId, label: "7235 +1", sentences: [] }]]));

const draw = (node: ReactElement) => renderToStaticMarkup(<svg>{node}</svg>);

describe("the blocked mark", () => {
  it("rings and hatches each blocked hex", () => {
    const markup = draw(<BlockedRings views={ONE_BLOCKED()} />);
    expect(markup.match(/data-blocked=/g)).toHaveLength(1);
    expect(markup).toContain('fill="url(#blocked-hatch)"');
    expect(markup).toContain('class="map-blocked-ring"');
  });

  it("writes the label at the foot of the hex", () => {
    const markup = draw(<BlockedLabels views={ONE_BLOCKED()} />);
    expect(markup).toContain("<text");
    expect(markup).toContain('class="map-blocked-label"');
    expect(markup).toContain(">7235 +1</text>");
  });

  it("draws nothing when no hex is blocked", () => {
    expect(renderToStaticMarkup(<BlockedRings views={views(new Map())} />)).toBe("");
    expect(renderToStaticMarkup(<BlockedLabels views={views(new Map())} />)).toBe("");
  });

  it("keeps pointer events off", () => {
    expect(draw(<BlockedRings views={ONE_BLOCKED()} />)).toContain('pointer-events="none"');
    expect(draw(<BlockedLabels views={ONE_BLOCKED()} />)).toContain('pointer-events="none"');
  });
});
