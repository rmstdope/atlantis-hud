import { useState } from "react";
import type { MageStanding } from "../magicStanding";
import { useEscapeToDismiss } from "./dismissLayer";

/**
 * Which of the faction's mages the study tree is tinted for.
 *
 * A real faction is mostly apprentices - fifteen of the smoke fixture's twenty-one mages hold
 * `manipulation 3` and nothing else - so the list is two groups, the adepts open and the
 * apprentices behind a fold that starts closed every time the menu opens. A fold that outlived
 * its own menu would be state nobody asked for.
 *
 * **Always a menu, even for one mage.** The header must not change shape between turn 1 and turn
 * 40, and a keyboard user must not lose a tab stop as the faction grows.
 *
 * **Split in three on purpose**, the way `MagicGraphView` is split in two: `MageMenu` is hook-free
 * and holds everything that is in the markup, so a test in this package can walk it -
 * `packages/shared/src/testing/README.md`, and there is no jsdom here (ah-nass).
 */
export function MagePicker({
  mages,
  picked,
  label,
  onPick
}: {
  mages: readonly MageStanding[];
  picked: MageStanding;
  /** How a region id reads to a player. `AppShell`'s `hexLabel`. */
  label: (regionId: string) => string;
  onPick: (unitId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [apprenticesShown, setApprenticesShown] = useState(false);

  const show = () => {
    setApprenticesShown(false);
    setOpen(true);
  };

  return (
    <span className="relative">
      <button
        type="button"
        data-testid="magic-tree-mage-picker"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        className="rounded border border-edge px-1.5 text-ink hover:text-ink"
      >
        Mage: {picked.name} ({picked.unitId})
      </button>
      {open ? (
        <MageMenuLayer onClose={() => setOpen(false)}>
          <MageMenu
            mages={mages}
            picked={picked}
            apprenticesShown={apprenticesShown}
            onShowApprentices={() => setApprenticesShown(true)}
            label={label}
            onPick={(unitId) => {
              onPick(unitId);
              setOpen(false);
            }}
          />
        </MageMenuLayer>
      ) : null}
    </span>
  );
}

/**
 * The open menu's one behaviour: Escape closes it, and the dialog beneath stays open.
 *
 * Not an exception to `dismissLayer`'s rule but a consequence of it - this layer is pushed after
 * the dialog's, so it is topmost and Escape is its own; the menu then unmounts, its layer pops,
 * and the next Escape reaches the dialog. `event.stopPropagation()` on a React handler would not
 * do it: the dialog listens on the document in the capture phase and would already have run.
 */
function MageMenuLayer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEscapeToDismiss(onClose);
  return <>{children}</>;
}

/** How many magic skills a mage has actually studied, in any of the three studied states. */
function knownCount(mage: MageStanding): number {
  return mage.counts.known + mage.counts.ceiling + mage.counts.maxed;
}

/** The list itself, and nothing else: no state, no effects, so a test can walk it. */
export function MageMenu({
  mages,
  picked,
  apprenticesShown,
  onShowApprentices,
  label,
  onPick
}: {
  mages: readonly MageStanding[];
  picked: MageStanding;
  apprenticesShown: boolean;
  onShowApprentices: () => void;
  /** How a region id reads to a player. `AppShell`'s `hexLabel`. */
  label: (regionId: string) => string;
  onPick: (unitId: string) => void;
}) {
  const adepts = mages.filter((mage) => mage.adept);
  const apprentices = mages.filter((mage) => !mage.adept);

  return (
    <div
      data-testid="magic-tree-mage-menu"
      role="menu"
      className="absolute top-full left-0 z-10 mt-1 max-h-[50vh] w-72 overflow-y-auto rounded border border-edge bg-panel-raised py-1 shadow-lg"
    >
      <p className="m-0 px-2 text-ink-dim">Mages — {adepts.length}</p>
      {adepts.map((mage) => (
        <MageRow key={mage.unitId} mage={mage} picked={picked} label={label} onPick={onPick} />
      ))}
      {apprentices.length === 0 ? null : apprenticesShown ? (
        <>
          <p className="m-0 mt-1 px-2 text-ink-dim">
            Apprentices — {apprentices.length}, manipulation only
          </p>
          {apprentices.map((mage) => (
            <MageRow key={mage.unitId} mage={mage} picked={picked} label={label} onPick={onPick} />
          ))}
        </>
      ) : (
        <button
          type="button"
          data-testid="magic-tree-mage-apprentices"
          aria-expanded={false}
          onClick={onShowApprentices}
          className="mt-1 block w-full bg-transparent px-2 text-left text-ink-dim hover:text-ink"
        >
          Apprentices — {apprentices.length}, manipulation only
        </button>
      )}
    </div>
  );
}

function MageRow({
  mage,
  picked,
  label,
  onPick
}: {
  mage: MageStanding;
  picked: MageStanding;
  label: (regionId: string) => string;
  onPick: (unitId: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`magic-tree-mage-${mage.unitId}`}
      role="menuitemradio"
      aria-checked={mage.unitId === picked.unitId}
      onClick={() => onPick(mage.unitId)}
      className={`block w-full bg-transparent px-2 text-left hover:bg-panel ${
        mage.unitId === picked.unitId ? "text-ink" : "text-ink-soft"
      }`}
    >
      {mage.name} ({mage.unitId}){" "}
      <span className="text-ink-dim">
        {knownCount(mage)} known · {mage.counts.open} can study · {label(mage.regionId)}
      </span>
    </button>
  );
}
