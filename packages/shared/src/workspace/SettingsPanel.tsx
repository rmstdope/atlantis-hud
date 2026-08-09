import { useEffect, useRef } from "react";
import { APP_VERSION } from "../appVersion";
import type { AppUpdateControl } from "./appUpdate";
import { updatePresentationFor } from "./appUpdate";

/**
 * What this build is, and whether there is a newer one.
 *
 * A panel anchored under a header button rather than a screen of its own, for the reason
 * `GamePicker` gives: this is a small, occasional question, and a workspace that vanishes to answer
 * it is more ceremony than the question deserves. The dismissal behaviour is deliberately identical
 * to the picker's, down to using pointerdown and testing the wrapper rather than the panel - see
 * the comments there for why each of those is not the obvious choice.
 *
 * It is reachable before a game exists, which is why `GameGate` renders it too. Asking which
 * version you are running should not require having created a game first.
 *
 * Issue #9's theme choice and snippets belong here when they arrive.
 */
export function SettingsPanel({
  platformLabel,
  appUpdate,
  onDismiss
}: {
  platformLabel: string;
  appUpdate: AppUpdateControl;
  onDismiss: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const trigger = panelRef.current?.parentElement ?? panelRef.current;
      if (!trigger?.contains(event.target as Node)) {
        onDismiss();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onDismiss]);

  const { message, action } = updatePresentationFor(appUpdate.state);

  return (
    <div
      ref={panelRef}
      data-testid="settings-panel"
      role="dialog"
      aria-label="Settings"
      // The header is the drop target for report files, so a panel hanging off it must not swallow
      // a drag that was meant for the header underneath.
      onDragOver={(event) => event.stopPropagation()}
      // `whitespace-normal` undoes the header's `whitespace-nowrap`, which would otherwise inherit
      // and run the update messages off the side of this panel.
      className="absolute right-0 top-full z-20 mt-1 w-64 rounded border border-edge bg-panel-raised p-2 text-[11.5px] whitespace-normal shadow-lg"
    >
      <dl className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-soft">Version</dt>
          <dd data-testid="app-version" className="text-ink">
            {APP_VERSION}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-soft">Build</dt>
          <dd className="text-ink">{platformLabel}</dd>
        </div>
      </dl>

      <div className="mt-2 border-t border-edge pt-2">
        {action ? (
          <button
            type="button"
            data-testid="check-for-updates"
            onClick={() => (action.kind === "apply" ? appUpdate.apply?.() : appUpdate.check())}
            className="w-full rounded border border-edge bg-panel px-2 py-1 text-brass hover:border-brass"
          >
            {action.label}
          </button>
        ) : null}
        {message ? (
          <p data-testid="update-status" className="mt-1.5 text-ink-soft">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
