import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every dialog with a top bar - a title row carrying its close button - renders through
 * `DialogFrame` (ah-yaat), which is where the veil, the drag by that bar (ah-aak5) and Escape live
 * and are tested (`DialogFrame.test.tsx`). The list is written out rather than discovered, so a
 * dialog that stops using the frame fails by name.
 *
 * Only the use of the frame is read from source: these dialogs take a game's worth of props, and
 * anything a frame does is pinned on the frame itself. A dialog that wires its own veil, drag or
 * Escape again beside the frame is the repetition the frame exists to end, so it fails here too.
 */
const FRAMED = [
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

describe("dialogs with a top bar render through the dialog frame", () => {
  it.each(FRAMED)("%s", (name) => {
    const text = source(name);
    expect(text).toContain("<DialogFrame");
    expect(text).not.toContain("useDialogDrag(");
    expect(text).not.toContain("useEscapeToDismiss(");
    expect(text).not.toContain("bg-black/50");
  });
});
