import { useSyncExternalStore } from "react";
import type { PanelSize } from "./panelResize";

/**
 * The size the player gave the Assistant changes panel (ah-hwkak.1), for as long as the app runs.
 *
 * It lives here rather than in the panel because the panel unmounts whenever its list empties, and
 * the next time it opens it opens at the player's size. Nothing is saved: a restart is the original
 * size again, as it is the panel's original position. `null` is the original size. The floating
 * window and the narrow window's bottom sheet are sized apart, so switching keeps each one.
 */
export type AssistantPanelSize = { floating: PanelSize | null; sheet: number | null };

const ORIGINAL: AssistantPanelSize = { floating: null, sheet: null };

let current: AssistantPanelSize = ORIGINAL;
const listeners = new Set<() => void>();

function set(next: AssistantPanelSize): void {
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

export function getAssistantPanelSize(): AssistantPanelSize {
  return current;
}

export function subscribeAssistantPanelSize(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setFloatingPanelSize(size: PanelSize): void {
  set({ ...current, floating: size });
}

export function resetFloatingPanelSize(): void {
  set({ ...current, floating: null });
}

export function setSheetPanelHeight(height: number): void {
  set({ ...current, sheet: height });
}

export function resetSheetPanelHeight(): void {
  set({ ...current, sheet: null });
}

export function resetAssistantPanelSizeForTests(): void {
  current = ORIGINAL;
}

export function useAssistantPanelSize(): AssistantPanelSize {
  return useSyncExternalStore(subscribeAssistantPanelSize, getAssistantPanelSize, () => ORIGINAL);
}
