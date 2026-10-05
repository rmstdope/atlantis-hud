import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { findByTestId } from "../testing/elementTree";
import type { RulesetGaps } from "../rulesetGaps";
import { openRulesetChange, rulesetChangeReducer, type RulesetChangeState } from "./rulesetChange";
import { RulesetChangeWarning, RulesetChangerView } from "./RulesetChanger";
import { GameSettings } from "./SettingsDialog";

const GAPS: RulesetGaps = {
  totalTurns: 5,
  affectedTurns: [2, 3, 4],
  groups: [
    { kind: "item", names: ["bounty token", "compass"] },
    { kind: "skill", names: ["call pirates"] },
    { kind: "structure", names: ["Canal"] }
  ],
  count: 4
};

function view(state: RulesetChangeState, currentId = "neworigins", busy = false) {
  return renderToStaticMarkup(
    <RulesetChangerView state={state} currentId={currentId} busy={busy} onChoose={vi.fn()} onPress={vi.fn()} />
  );
}

const chosen = (rulesetId: string) =>
  rulesetChangeReducer(openRulesetChange("neworigins"), { type: "choose", rulesetId });

describe("the ruleset list in Settings' per-game tab (ah-gicw)", () => {
  it("lists every ruleset by its own name and opens on the current one", () => {
    const markup = view(openRulesetChange("neworigins"));

    expect(markup).toContain('<option value="neworigins" selected="">New Origins</option>');
    expect(markup).toContain(">New Age: Arcanum</option>");
    expect(markup).toContain(">New Age: Trident</option>");
    expect(markup).toContain(">Ruleset</label>");
    expect(markup).toContain("The game’s reports are read again under the new ruleset.");
  });

  it("dims Change ruleset until another ruleset is chosen", () => {
    expect(view(openRulesetChange("neworigins"))).toMatch(/disabled=""[^>]*>Change ruleset<\/button>/u);
    expect(view(chosen("newage-trident"))).not.toMatch(/disabled=""[^>]*>Change ruleset<\/button>/u);
  });

  it("presses through to the handler", () => {
    const onPress = vi.fn();
    const tree = RulesetChangerView({
      state: chosen("newage-trident"),
      currentId: "neworigins",
      busy: false,
      onChoose: vi.fn(),
      onPress
    });

    (findByTestId(tree, "settings-game-ruleset-change").props.onClick as () => void)();

    expect(onPress).toHaveBeenCalled();
  });

  it("reads Changing… while working", () => {
    expect(view(rulesetChangeReducer(chosen("newage-trident"), { type: "start" }))).toContain("Changing…");
  });

  it("confirms a change in green, with the ruleset in bold", () => {
    const state: RulesetChangeState = {
      ...openRulesetChange("newage-arcanum"),
      line: { kind: "changed", rulesetId: "newage-arcanum" }
    };

    expect(view(state, "newage-arcanum")).toMatch(
      /class="text-ok">✓ Changed to <b>New Age: Arcanum<\/b>\.<\/span>/u
    );
  });

  it("says in amber how many names are not defined after Change anyway", () => {
    const state: RulesetChangeState = {
      ...openRulesetChange("newage-trident"),
      line: { kind: "changedAnyway", rulesetId: "newage-trident", count: 10 }
    };

    expect(view(state, "newage-trident")).toMatch(
      /class="text-warn">⚠ Changed to <b>New Age: Trident<\/b> — 10 names in this game’s reports are not defined in it\.<\/span>/u
    );
  });

  it("says in red why a change failed, and that the game is still on its ruleset", () => {
    const state: RulesetChangeState = {
      ...openRulesetChange("neworigins"),
      line: { kind: "failed", reason: "disk full" }
    };

    expect(view(state)).toContain("Couldn’t change the ruleset: disk full. The game is still on New Origins.");
  });

  it("replaces the old read-only line in the per-game tab", () => {
    const markup = renderToStaticMarkup(
      <GameSettings
        game={{
          gameId: "g",
          gameName: "A game",
          databasePath: "g.db",
          rulesetId: "neworigins",
          map: { width: 72, height: 96, wrapX: true, wrapY: false }
        }}
        busy={false}
        error={null}
        onChangeMapSizes={async () => true}
        onCheckRuleset={async () => GAPS}
        onChangeRuleset={async () => undefined}
      />
    );

    expect(markup).not.toContain("The ruleset is chosen when this game is created.");
    expect(markup).toContain('data-testid="settings-game-ruleset-change"');
  });
});

describe("the warning before a change that leaves names undefined (ah-gicw)", () => {
  function warning() {
    return renderToStaticMarkup(
      <RulesetChangeWarning rulesetLabel="New Age: Trident" gaps={GAPS} onCancel={vi.fn()} onConfirm={vi.fn()} />
    );
  }

  it("names the ruleset in its title and intro", () => {
    const markup = warning();

    expect(markup).toContain("⚠ Change to New Age: Trident?");
    expect(markup).toContain(
      "3 of this game’s 5 turns name 4 things the <b>New Age: Trident</b> ruleset doesn’t define. They will show without their game data if you change."
    );
    expect(markup).toContain("Not defined in New Age: Trident");
  });

  it("puts the turns first, then the groups in order, names in the monospace face", () => {
    const markup = warning();
    const order = ["Turns 2, 3, 4", "Items (2)", "Skills (1)", "Buildings and ships (1)"].map((text) =>
      markup.indexOf(text)
    );

    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markup).toContain('<div class="font-mono">bounty token, compass</div>');
    expect(markup).not.toContain("Races (");
  });

  it("scrolls its names inside a fixed height", () => {
    expect(warning()).toMatch(/data-testid="ruleset-change-warning-names" class="[^"]*max-h-40 overflow-y-auto/u);
  });

  it("offers Cancel, focused, then Change anyway", () => {
    const markup = warning();

    expect(markup.indexOf(">Cancel</button>")).toBeLessThan(markup.indexOf(">Change anyway</button>"));
    expect(markup).toMatch(/data-testid="ruleset-change-warning-cancel" autofocus=""/u);
  });
});
