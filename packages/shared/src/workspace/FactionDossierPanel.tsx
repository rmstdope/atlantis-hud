import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FactionDossier } from "../factionDossier";
import { placeTooltip, type Point } from "../unitTooltip";
import { usePopoverDismiss } from "./popover";
import { POPOVER_BODY_MAX_H } from "./primitives";
import { PopoverFrame } from "./popover";

/** Said under *Seen in*, so an empty list reads as "we cannot see" rather than "they have none". */
export const SEEN_IN_LIMIT = "Where their units are this turn. Earlier turns are not remembered.";

/** Said under *Known units*, for the same reason: `factionId` is null for a concealed unit. */
export const KNOWN_UNITS_LIMIT = "A unit hiding its faction is not counted here.";

/**
 * Everything this turn's report knows about one foreign faction, opened by clicking its name in the
 * attitudes list or in the units-in-hex table.
 *
 * A **popover**, not a dialog, and that is the whole design (ah-bu2c): every dialog in this
 * workspace is modal - `fixed inset-0 ... bg-black/50` - so it dims the map the hover highlight is
 * drawn on, and a highlight nobody can see is not a feature. `TradePanel` already has this exact
 * shape, and its props are inherited deliberately, hover comment included.
 */
export function FactionDossierPanel({
  dossier,
  labelFor,
  onHoverHex,
  onSelectHex,
  onSelectUnit,
  onBack,
  onDismiss
}: {
  dossier: FactionDossier;
  /** How a hex reads in the interface, for instance `mountain (7,53)`. */
  labelFor: (regionId: string) => string;
  /**
   * The row the reader is on, so the map can ring it - and `null` the moment they look away.
   *
   * Called on focus as well as on hover: every row is a button, so this list is tabbed through, and
   * a hover-only feature would show a keyboard reader nothing at all.
   */
  onHoverHex: (regionId: string | null) => void;
  onSelectHex: (regionId: string) => void;
  onSelectUnit: (unitId: string) => void;
  /**
   * Set only where the dossier took the place of another popover's contents - the attitudes list,
   * which cannot hold a nested popover: its body scrolls, so a panel hung inside it is clipped.
   * The reader came from somewhere, so there has to be a way back to it that is not "closed".
   */
  onBack?: () => void;
  onDismiss: () => void;
}) {
  return (
    <PopoverFrame testId="faction-dossier" label="Faction dossier" align="left" width="w-80">
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
        {onBack ? (
          <button
            type="button"
            data-testid="dossier-back"
            aria-label="back to the faction view"
            onClick={onBack}
            className="rounded px-1 text-ink-dim hover:text-ink"
          >
            ‹
          </button>
        ) : null}
        <span className="text-ink">
          {dossier.name}
          <span className="text-ink-dim"> ({dossier.id})</span>
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="close faction dossier"
          onClick={onDismiss}
          className="rounded px-1.5 text-ink-dim hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className={`${POPOVER_BODY_MAX_H} overflow-y-auto p-2`}>
        <div className="text-brass">Attitude</div>
        <p className={dossier.attitude === null ? "text-ink-dim italic" : "text-ink"}>
          {dossier.attitude ?? "not declared"}
        </p>

        <div className="mt-2 text-brass">Seen in</div>
        <p className="text-ink-dim">{SEEN_IN_LIMIT}</p>
        {dossier.hexes.length === 0 ? (
          <p className="text-ink-dim italic">no hex of theirs is in this report</p>
        ) : (
          <ul className="mt-1 list-none">
            {dossier.hexes.map((hex) => (
              <li key={hex.regionId}>
                <button
                  type="button"
                  data-testid={`dossier-hex-${hex.regionId}`}
                  aria-label={`go to ${labelFor(hex.regionId)}`}
                  onPointerEnter={() => onHoverHex(hex.regionId)}
                  onPointerLeave={() => onHoverHex(null)}
                  onFocus={() => onHoverHex(hex.regionId)}
                  onBlur={() => onHoverHex(null)}
                  onClick={() => {
                    onSelectHex(hex.regionId);
                    onDismiss();
                  }}
                  className="flex w-full items-baseline gap-2 rounded px-1 text-left hover:bg-panel"
                >
                  <span className="text-ink">{labelFor(hex.regionId)}</span>
                  <span className="flex-1" />
                  <span className="text-ink-soft">
                    {hex.unitCount} unit{hex.unitCount === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 text-brass">Known units</div>
        <p className="text-ink-dim">{KNOWN_UNITS_LIMIT}</p>
        {dossier.units.length === 0 ? (
          <p className="text-ink-dim italic">no unit of theirs is in this report</p>
        ) : (
          <ul className="mt-1 list-none">
            {dossier.units.map((unit) => (
              <li key={`${unit.regionId}-${unit.unitId}`}>
                <button
                  type="button"
                  data-testid={`dossier-unit-${unit.unitId}`}
                  aria-label={`go to ${unit.name} (${unit.unitId}) in ${labelFor(unit.regionId)}`}
                  onPointerEnter={() => onHoverHex(unit.regionId)}
                  onPointerLeave={() => onHoverHex(null)}
                  onFocus={() => onHoverHex(unit.regionId)}
                  onBlur={() => onHoverHex(null)}
                  onClick={() => {
                    onSelectUnit(unit.unitId);
                    onDismiss();
                  }}
                  className="flex w-full items-baseline gap-2 rounded px-1 text-left hover:bg-panel"
                >
                  <span className="text-ink">{unit.name}</span>
                  <span className="text-ink-dim">({unit.unitId})</span>
                  <span className="flex-1" />
                  <span className="text-ink-soft">{labelFor(unit.regionId)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PopoverFrame>
  );
}

/**
 * The dossier floating beside the name that was clicked, wherever on screen that name is.
 *
 * Rendered into the body rather than beside the row, for the reason `UnitTooltip` gives: the panel
 * behind the units table clips what overflows it and blurs its backdrop, and a blurred ancestor is
 * what a fixed position resolves against - inside the panel this would be trapped in it and cut
 * off at its edge. Placed once measured, so the arithmetic that keeps it on screen works on the
 * size the panel actually took.
 */
export function FloatingFactionDossier({
  at,
  ...panel
}: { at: Point } & Parameters<typeof FactionDossierPanel>[0]) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  // Escape and a press elsewhere close it, like every other popover here. Portalled into the body,
  // so the wrapper it guards is this panel alone: a press on the name that opened it counts as
  // outside, and that button's own click reopens it - which is the behaviour a reader expects
  // from a name that toggles a panel.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  usePopoverDismiss(wrapperRef, true, panel.onDismiss);

  useLayoutEffect(() => {
    if (!node) {
      return;
    }
    // The PANEL, not the wrapper: `PopoverFrame` is absolutely positioned, so it contributes
    // nothing to its parent's layout and the wrapper measures 0x0 - which would make
    // `placeTooltip` return `at` plus its gap for every input, unable to flip or clamp, and put a
    // 320px panel off the bottom of the window for a name clicked in the units dock.
    const measured = node.querySelector<HTMLElement>('[data-testid="faction-dossier"]') ?? node;
    setPlaced(
      placeTooltip(
        at,
        { width: measured.offsetWidth, height: measured.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [node, at, panel.dossier.id]);

  // Focus moves into the panel once it is placed. Portalled to the body, it sits at the end of the
  // document, so without this a keyboard reader tabs on through the units table and never reaches
  // the rows - and `PopoverFrame` announces a dialog that focus never entered.
  useLayoutEffect(() => {
    if (placed && node) {
      node.focus();
    }
  }, [placed, node]);

  return createPortal(
    <div
      ref={(element) => {
        setNode(element);
        wrapperRef.current = element;
      }}
      // Hidden until placed, which is one layout pass and no painted frame; the inner span is
      // `relative` because PopoverFrame positions itself against its wrapper.
      tabIndex={-1}
      className="fixed z-50 w-max outline-none"
      style={{
        left: placed?.left ?? 0,
        top: placed?.top ?? 0,
        visibility: placed ? "visible" : "hidden"
      }}
    >
      <span className="relative block">
        <FactionDossierPanel {...panel} />
      </span>
    </div>,
    document.body
  );
}
