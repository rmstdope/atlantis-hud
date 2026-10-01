import { Fragment, useState } from "react";
import type { UnclaimedSilverUse } from "@atlantis/core-client";
import type { Point } from "../unitTooltip";
import { TooltipPortal } from "./TooltipPortal";

const TOOLTIP_ID = "unclaimed-silver-use-tooltip";

export function UnclaimedSilverUseBreakdown({ usage }: { usage: UnclaimedSilverUse }) {
  const groups = [
    { label: "CLAIM", group: usage.claims },
    { label: "WITHDRAW", group: usage.withdrawals },
    { label: "Maintenance", group: usage.maintenance }
  ];

  return (
    <>
      <p className="m-0 mb-1 font-medium text-brass">From unclaimed silver this turn</p>
      {groups.map(({ label, group }) =>
        group.amount > 0 || group.entries.length > 0 ? (
          <div key={label} className="grid grid-cols-[1fr_auto] gap-x-2">
            <span>{label}</span>
            <span className="text-right tabular-nums">{group.amount}</span>
            {group.entries.slice(0, 3).map((entry, index) => (
              <Fragment key={`${entry.unitId}-${index}`}>
                <span
                  className="truncate pl-2 text-ink-dim"
                  title={`${entry.unitName} (${entry.unitId})${entry.detail ? ` · ${entry.detail}` : ""}`}
                >
                  {entry.unitName} ({entry.unitId}){entry.detail ? ` · ${entry.detail}` : ""}
                </span>
                <span className="text-right text-ink-dim tabular-nums">{entry.amount}</span>
              </Fragment>
            ))}
            {group.entries.length > 3 ? (
              <>
                <span className="pl-2 text-ink-dim">
                  + {group.entries.length - 3} more {group.entries.length === 4 ? "unit" : "units"}
                </span>
                <span className="text-right text-ink-dim tabular-nums">
                  {group.entries.slice(3).reduce((total, entry) => total + entry.amount, 0)}
                </span>
              </>
            ) : null}
          </div>
        ) : null
      )}
      {usage.notCounted.length > 0 ? (
        <div className="mt-1 border-t border-edge pt-1 text-danger">
          Not counted:
          {usage.notCounted.map((rejection, index) => (
            <div
              key={`${rejection.unitId}-${index}`}
              title={`${rejection.unitName} (${rejection.unitId}) WITHDRAW ${rejection.order}`}
            >
              {rejection.unitName} ({rejection.unitId}) WITHDRAW {rejection.order} —{" "}
              {rejection.reason === "insufficient-funds"
                ? "not enough unclaimed silver"
                : rejection.reason === "not-basic-item"
                  ? "not a basic item"
                  : "no WITHDRAW in the Nexus"}
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-1 grid grid-cols-[1fr_auto] border-t border-edge pt-1">
        <span>Total</span>
        <span className="text-right tabular-nums">{usage.used}</span>
      </div>
    </>
  );
}

export function UnclaimedSilverUseTrigger({
  usage,
  open,
  onOpen,
  onClose
}: {
  usage: UnclaimedSilverUse;
  open: boolean;
  onOpen: (point: Point) => void;
  onClose: () => void;
}) {
  const value = usage.used > 0 ? usage.used : "none";
  const focusPoint = (target: HTMLButtonElement): Point => {
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  return (
    <button
      type="button"
      data-testid="unclaimed-silver-use-trigger"
      aria-label={`Expected use this turn: ${value}; ${usage.remaining} left`}
      aria-expanded={open}
      aria-controls={open ? TOOLTIP_ID : undefined}
      aria-describedby={open ? TOOLTIP_ID : undefined}
      className="border-b border-dotted border-brass text-ink hover:text-brass-bright focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
      onMouseEnter={(event) => onOpen({ x: event.clientX, y: event.clientY })}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(event.currentTarget.ownerDocument.activeElement)) {
          onClose();
        }
      }}
      onFocus={(event) => onOpen(focusPoint(event.currentTarget))}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onClose();
        }
      }}
      onClick={(event) => onOpen(focusPoint(event.currentTarget))}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {value}
    </button>
  );
}

export function UnclaimedSilverUseDetails({ usage }: { usage: UnclaimedSilverUse }) {
  const [at, setAt] = useState<Point | null>(null);

  return (
    <>
      <UnclaimedSilverUseTrigger
        usage={usage}
        open={at !== null}
        onOpen={setAt}
        onClose={() => setAt(null)}
      />
      {at !== null ? (
        <TooltipPortal
          id={TOOLTIP_ID}
          at={at}
          anchorKey={JSON.stringify(usage)}
          testId="unclaimed-silver-use-tooltip"
        >
          <UnclaimedSilverUseBreakdown usage={usage} />
        </TooltipPortal>
      ) : null}
    </>
  );
}
