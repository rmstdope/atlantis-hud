import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every dialog with a top bar - a title row carrying its close (x) button - moves by that bar
 * (ah-aak5). The list is the plan's, and is written out rather than discovered so a dialog that
 * loses its drag, or a new one added here without it, fails by name.
 *
 * Read from source rather than rendered: several of these take a game's worth of props, and what is
 * pinned is only the wiring - the bar spreads the drag's props, the box takes its ref and style, and
 * the veil is dropped once moved. The behaviour itself is `dialogDrag.test.ts` and the smoke suite's
 * `dialog-drag.spec.ts`.
 */
const MOVABLE = [
  "SettingsDialog",
  "MapSizesSettings",
  "ProductionDialog",
  "MapExportDialog",
  "BattlesDialog",
  "ChangesDialog",
  "ShortcutHelp",
  "MagicTreeDialog",
  "ArmyExportDialog",
  "GameDataDialog",
  "StudyPlannerDialog"
];

const source = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./${name}.tsx`, import.meta.url)), "utf8");

describe("dialogs with a top bar move by it", () => {
  it.each(MOVABLE)("%s", (name) => {
    const text = source(name);
    // `drag?.` where the drawing is a hook-free panel that a static render draws unmoved.
    expect(text).toContain("useDialogDrag()");
    expect(text).toMatch(/\{\.\.\.drag\??\.barProps\}\s*className="[^"]*cursor-move select-none/);
    expect(text).toMatch(/style=\{drag\??\.dialogStyle\}/);
    expect(text).toMatch(/drag\.dialogRef/);
    expect(text).toMatch(/drag(\?\.moved === true|\.moved) \? "" : " bg-black\/50"/);
  });
});
