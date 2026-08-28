/**
 * The chip that follows the pointer while units are being dragged onto an Army (`ah-1mpx.4`).
 *
 * Written straight to the DOM rather than through React state, modelled on `reorderFeedback.ts`'s
 * `createReorderFeedback` and for the reason that module already states: a state update per
 * `pointermove` makes the gesture stutter.
 */

export type UnitDragChip = {
  /** Draws it on the first call, then moves it. Nothing appears for a press that never moved. */
  moveTo(clientX: number, clientY: number): void;
  /** Takes it away. Safe to call twice - `pointerup` and `pointercancel` can both arrive. */
  remove(): void;
};

/**
 * The chip, appended to `document.body` and positioned `fixed`.
 *
 * **The body, never the pane.** `CollapsiblePanel` is `overflow-hidden` with `backdrop-blur`, and
 * a blurred ancestor is what a fixed position resolves against - so a chip created inside the pane
 * would be trapped in it and clipped at its edge. That is the same fact `UnitTooltip.tsx` records
 * and portals to the body to escape, and this drag has to cross from the table to the rail, which
 * no element inside the table's scroller can do.
 *
 * `label` is `3 units` for a pick of two or more and the unit's own **name** for one - `Vanguard`,
 * never `1 unit` (W2).
 *
 * `host` is the test seam and nothing more: this package has no jsdom, so the only way to pin what
 * goes into the body is to be handed one (`reorderFeedback.test.ts` does the same).
 */
export function createUnitDragChip(
  label: string,
  host: HTMLElement = document.body
): UnitDragChip {
  const create = (host.ownerDocument ?? document).createElement.bind(
    host.ownerDocument ?? document
  );
  let chip: HTMLElement | null = null;

  return {
    moveTo(clientX, clientY) {
      if (!chip) {
        chip = create("div") as HTMLElement;
        // `reorderFeedback`'s chip verbatim, with `absolute` swapped for `fixed` and a `z-50`
        // added, so the two chips in the application look alike. Whole literals, never assembled:
        // Tailwind's scanner reads source text.
        chip.className =
          "pointer-events-none fixed z-50 -translate-x-1/2 whitespace-nowrap rounded border border-brass bg-panel px-1 text-pane-sm text-ink shadow";
        chip.dataset.testid = "unit-drag-chip";
        chip.textContent = label;
        host.appendChild(chip);
      }
      chip.style.left = `${clientX}px`;
      chip.style.top = `${clientY}px`;
    },
    remove() {
      chip?.remove();
      chip = null;
    }
  };
}
