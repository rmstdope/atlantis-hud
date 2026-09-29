import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mapSizesDraftOf } from "../mapShape";
import { GameSettings } from "./SettingsDialog";
import { MapSizesEditorPanel } from "./MapSizesSettings";

const trident = {
  levels: {
    surface: { width: 64, height: 64 },
    underworld: { width: 48, height: 48 },
    underdeep: { width: 24, height: 24 },
    dungeon: { width: 128, height: 32 }
  },
  wrapX: true,
  wrapY: false
};

const game = {
  gameId: "g",
  gameName: "Trident game",
  databasePath: "g.db",
  rulesetId: "newage-trident",
  map: { width: 64, height: 64, wrapX: true, wrapY: false },
  mapSizes: trident
};

function settings(overrides: Partial<typeof game> = {}) {
  return renderToStaticMarkup(
    <GameSettings game={{ ...game, ...overrides }} busy={false} error={null} onChangeMapSizes={async () => true} />
  );
}

describe("World settings' map sizes (ah-4hwa)", () => {
  it("summarises every configured level, not just the surface", () => {
    const markup = settings();
    for (const line of ["Surface 64 × 64", "Underworld 48 × 48", "Underdeep 24 × 24", "Dungeon 128 × 32", "Wraps east to west"]) {
      expect(markup).toContain(`<li>${line}</li>`);
    }
  });

  it("gives each level a line of its own at the settings' normal size (ah-ciiq)", () => {
    const markup = settings();
    expect(markup.match(/<li>/gu)).toHaveLength(5);
    expect(markup).not.toMatch(/data-testid="settings-map-sizes-summary"[^>]*text-pane-xs/u);
  });

  it("offers no editable map fields outside Edit map sizes", () => {
    const markup = settings();
    expect(markup).not.toContain("<input");
    expect(markup).toContain('data-testid="settings-map-sizes-edit"');
  });

  it("summarises a game created before map levels by its surface", () => {
    const legacy: Omit<typeof game, "mapSizes"> = { ...game };
    delete (legacy as Partial<typeof game>).mapSizes;
    const markup = renderToStaticMarkup(
      <GameSettings game={legacy} busy={false} error={null} onChangeMapSizes={async () => true} />
    );
    expect(markup).toContain("<li>Surface 64 × 64</li><li>Underworld not configured</li>");
  });
});

describe("the Edit map sizes window (ah-4hwa)", () => {
  const panel = (confirming: { level: "underworld"; field: "height" } | null = null) =>
    renderToStaticMarkup(
      <MapSizesEditorPanel
        draft={mapSizesDraftOf(trident)}
        busy={false}
        confirming={confirming}
        onDraft={() => {}}
        onSave={() => {}}
        onConfirm={() => {}}
        onKeepEditing={() => {}}
        onCancel={() => {}}
      />
    );

  it("is a focused window with the agreed copy", () => {
    const markup = panel();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="Edit map sizes"');
    expect(markup).toContain("Change a level’s size, add a level, or clear both fields to remove a level.");
    expect(markup).toContain("Wrap east to west");
    expect(markup).toContain("Applies to every map level.");
    expect(markup).toContain(">Surface<");
  });

  it("draws every field and button as a control rather than bare text", () => {
    const markup = panel();
    const controls = markup.match(/<(input|button)\b[^>]*>/gu) ?? [];
    expect(controls.length).toBeGreaterThan(8);
    for (const control of controls) {
      expect(control).toMatch(/class="[^"]*\b(rounded|accent-)/u);
    }
  });

  it("uses the same rows as creating a world", () => {
    const markup = panel();
    expect(markup).toContain('data-testid="settings-map-sizes-surface-width"');
    expect(markup).toContain('data-testid="settings-map-sizes-wrap-x"');
  });

  it("names the level made smaller when it asks before saving", () => {
    const markup = panel({ level: "underworld", field: "height" });
    expect(markup).toContain('aria-label="Save map sizes?"');
    expect(markup).toContain("Making Underworld smaller may remove parts of this level that are outside its new size.");
    expect(markup).toContain("Keep editing");
  });
});
