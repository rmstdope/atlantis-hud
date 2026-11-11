import type { ArmyRecord, OrderDiagnostic, OpenedGame, ParsedReport } from "@atlantis/core-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NO_ASSISTANT_CHANGES,
  assistantChangeProblems,
  assistantChangeViews,
  assistantChipLabel,
  currentOrdersOf,
  keepAssistantChange,
  recordAssistantWrite,
  settleAssistantChanges,
  type AssistantArmyChange,
  type AssistantChangesState
} from "../assistant/assistantChanges";
import {
  loadAssistantChanges,
  saveAssistantChanges,
  type AssistantChangesScope
} from "../assistant/assistantChangesStorage";
import type { OrderProcessing } from "../orderProcessing";
import { sideOf } from "../assistant/assistantArmies";
import {
  assistantArmyViews,
  keepAssistantArmyChange,
  recordAssistantArmyWrite,
  settleAssistantArmyChanges,
  withArmyEntry
} from "../assistant/assistantArmyChanges";
import { draftKeyFor } from "../orderDraft";

type Held = { key: string | null; scope: AssistantChangesScope | null; state: AssistantChangesState };

function scopeOf(enabled: boolean, game: OpenedGame | null, parsed: ParsedReport | null): AssistantChangesScope | null {
  const draft = draftKeyFor(parsed);
  return !enabled || game === null || draft === null
    ? null
    : { gameId: game.manifest.metadata.gameId, factionId: draft.factionId, turn: draft.turnNumber };
}

function keyOf(scope: AssistantChangesScope | null): string | null {
  return scope === null ? null : `${scope.gameId}/${scope.factionId}/${scope.turn}`;
}

/**
 * The owner of the assistant changes list (ah-bcdri): one list per open turn, kept across a restart,
 * and settled against the orders as they change. The rules are `assistant/assistantChanges`.
 */
export function useAssistantChanges(input: {
  /** Only with an assistant connection; without one nothing is stored and nothing shows. */
  enabled: boolean;
  game: OpenedGame | null;
  parsed: ParsedReport | null;
  document: string;
  validated: { text: string; diagnostics: OrderDiagnostic[] };
  orders: OrderProcessing;
  /**
   * The open game's Armies (ah-mjiv1), or `null` while they are not loaded for it: an Army entry is
   * neither drawn nor settled against a list that is not yet the game's.
   */
  armies: readonly ArmyRecord[] | null;
}) {
  const { enabled, game, parsed, document, validated, orders, armies } = input;
  const scope = scopeOf(enabled, game, parsed);
  const key = keyOf(scope);
  const [held, setHeld] = useState<Held>({ key: null, scope: null, state: NO_ASSISTANT_CHANGES });

  // Adjusted during render, so no render ever shows one turn's list over another.
  if (held.key !== key) {
    setHeld({ key, scope, state: scope === null ? NO_ASSISTANT_CHANGES : loadAssistantChanges(scope) });
  }
  const state = held.key === key ? held.state : NO_ASSISTANT_CHANGES;

  const problems = useMemo(
    () => assistantChangeProblems({ state, parsed, validated, orders }),
    [state, parsed, validated, orders]
  );
  const views = useMemo(
    () => (state.changes.length === 0 ? [] : assistantChangeViews({ state, document, parsed, problems, orders })),
    [state, document, parsed, problems, orders]
  );

  const armyViews = useMemo(
    () => (state.armies.length === 0 || armies === null ? [] : assistantArmyViews(state, armies)),
    [state, armies]
  );

  useEffect(() => {
    if (state.armies.length === 0 || armies === null) {
      return;
    }
    setHeld((now) => {
      if (now.key !== key) {
        return now;
      }
      const settled = settleAssistantArmyChanges(now.state, armies);
      return settled === now.state ? now : { ...now, state: settled };
    });
  }, [armies, key, state]);

  useEffect(() => {
    if (state.changes.length === 0) {
      return;
    }
    const current = currentOrdersOf(document, state.changes.map((change) => change.unitId), orders);
    setHeld((now) => {
      if (now.key !== key) {
        return now;
      }
      const settled = settleAssistantChanges(now.state, current);
      return settled === now.state ? now : { ...now, state: settled };
    });
  }, [document, key, orders, state]);

  useEffect(() => {
    if (held.scope !== null) {
      saveAssistantChanges(held.scope, held.state);
    }
  }, [held]);

  const update = useCallback((change: (now: AssistantChangesState) => AssistantChangesState) => {
    setHeld((now) => ({ ...now, state: change(now.state) }));
  }, []);

  const recordWrite = useCallback(
    (unitId: string, documentBefore: string, documentAfter: string) => {
      const read = (text: string) => orders.readUnitOrders(text, unitId, undefined) ?? "";
      const write = { unitId, replaced: read(documentBefore), wrote: read(documentAfter) };
      update((now) => recordAssistantWrite(now, write));
    },
    [orders, update]
  );

  /**
   * One write of the assistant's to an Army (ah-mjiv1); `previous` is `null` for a new one. Answers
   * the undo for a write whose save then fails: the Army's entry as it was before this write.
   */
  const recordArmyWrite = useCallback(
    (next: ArmyRecord, previous: ArmyRecord | null): (() => void) => {
      const write = { armyId: next.id, replaced: previous === null ? null : sideOf(previous), wrote: sideOf(next) };
      let prior: AssistantArmyChange | undefined;
      let seen = false;
      update((now) => {
        if (!seen) {
          prior = now.armies.find((change) => change.armyId === next.id);
          seen = true;
        }
        return recordAssistantArmyWrite(now, write);
      });
      return () => update((now) => withArmyEntry(now, next.id, prior));
    },
    [update]
  );

  const replace = useCallback((next: AssistantChangesState) => update(() => next), [update]);
  const keep = useCallback((unitId: string) => update((now) => keepAssistantChange(now, unitId)), [update]);
  const keepArmy = useCallback((armyId: string) => update((now) => keepAssistantArmyChange(now, armyId)), [update]);
  const keepAll = useCallback(() => update((now) => ({ ...now, changes: [], armies: [] })), [update]);
  /** Lists an Army's change again, as it was: for a Revert whose save failed. */
  const restoreArmy = useCallback(
    (change: AssistantArmyChange) => update((now) => withArmyEntry(now, change.armyId, change)),
    [update]
  );

  // The cursor goes with a deliberate open or close, never with one that happened by itself: it
  // waits here for the render that puts its target on screen.
  const panelRef = useRef<HTMLElement | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const focusTarget = useRef<"panel" | "chip" | null>(null);
  const [focusAsked, setFocusAsked] = useState(0);

  const askFocus = useCallback((target: "panel" | "chip") => {
    focusTarget.current = target;
    setFocusAsked((count) => count + 1);
  }, []);

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target !== null) {
      (target === "panel" ? panelRef : chipRef).current?.focus();
    }
  }, [state.open, focusAsked]);

  const show = useCallback(() => {
    update((now) => ({ ...now, open: true }));
    askFocus("panel");
  }, [askFocus, update]);

  const close = useCallback(() => {
    update((now) => ({ ...now, open: false }));
    askFocus("chip");
  }, [askFocus, update]);

  return {
    state,
    views,
    armyViews,
    /** Whether anything at all is listed, units or Armies. */
    listed: views.length + armyViews.length > 0,
    open: state.open,
    chipLabel: !state.open && views.length + armyViews.length > 0 ? assistantChipLabel(views, armyViews.length) : null,
    recordWrite,
    recordArmyWrite,
    replace,
    keep,
    keepArmy,
    keepAll,
    restoreArmy,
    show,
    close,
    panelRef,
    chipRef
  };
}
