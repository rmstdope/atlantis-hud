import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { aReportUnit, type SkillInfo } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "../gameData";
import { buildMagicTree } from "../magicTree";
import { magesOf } from "../magicStanding";
import { findByTestId, queryByTestId } from "../testing/elementTree";
import { MageMenu } from "./MagePicker";

const index = parseGameData(readRuleset()) as GameDataIndex;
const tree = buildMagicTree(index);

const held = (levels: Record<string, number>): SkillInfo[] =>
  Object.entries(levels).map(([tag, level]) => ({
    name: tag.toLowerCase(),
    tag,
    level,
    points: level * 30
  }));

/** The smoke fixture's shape: twenty-one mages, of whom fifteen hold manipulation and nothing else. */
const MAGES = magesOf(
  [
    ...Array.from({ length: 15 }, (_, n) =>
      aReportUnit({ unitId: `${100 + n}`, name: `Apprentice ${n}`, skills: held({ MANI: 3 }) })
    ),
    ...Array.from({ length: 6 }, (_, n) =>
      aReportUnit({
        unitId: `${200 + n}`,
        name: `Adept ${n}`,
        skills: held({ FORC: 4, PATT: 3, ILLU: 3 })
      })
    )
  ],
  tree,
  index
);

const menu = (apprenticesShown: boolean, onPick: (unitId: string) => void = () => {}) => (
  <MageMenu
    mages={MAGES}
    picked={MAGES[0]}
    apprenticesShown={apprenticesShown}
    onShowApprentices={() => {}}
    label={(regionId) => `hex ${regionId}`}
    onPick={onPick}
  />
);

const rows = (html: string) => html.match(/data-testid="magic-tree-mage-\d+"/g)?.length ?? 0;

describe("MageMenu", () => {
  it("lists the adepts and folds the apprentices away", () => {
    const html = renderToStaticMarkup(menu(false));

    expect(rows(html)).toBe(6);
    expect(html).toContain("Mages — 6");
    expect(html).toContain('data-testid="magic-tree-mage-apprentices"');
    expect(html).toContain("Apprentices — 15, manipulation only");
    expect(html).toContain('data-testid="magic-tree-mage-200"');
    expect(html).not.toContain('data-testid="magic-tree-mage-100"');
  });

  it("lists every mage once the fold is opened", () => {
    const html = renderToStaticMarkup(menu(true));

    expect(rows(html)).toBe(21);
    expect(html).toContain('data-testid="magic-tree-mage-100"');
    expect(html).not.toContain('data-testid="magic-tree-mage-apprentices"');
  });

  it("says what each mage knows and where he stands", () => {
    const html = renderToStaticMarkup(menu(false));

    // An adept holding force 4, pattern 3 and illusion 3: three studied, and pattern's 3 is a
    // ceiling on plenty besides.
    expect(html).toContain("Adept 0 (200)");
    expect(html).toContain("3 known · ");
    expect(html).toContain("hex 1:7,53");
  });

  it("picks the mage whose row was clicked", () => {
    let picked: string | null = null;
    const tree = menu(false, (unitId) => (picked = unitId));

    (findByTestId(tree, "magic-tree-mage-203").props.onClick as () => void)();

    expect(picked).toBe("203");
    expect(queryByTestId(tree, "magic-tree-mage-104")).toBeNull();
  });
});
