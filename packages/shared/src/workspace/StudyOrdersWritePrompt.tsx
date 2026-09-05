import { useEffect, useRef } from "react";
import type { StudyWritePlan } from "../studyOrdersWrite";
import { useEscapeToDismiss } from "./dismissLayer";

/**
 * The confirmation for "Put into my orders": every mage, and exactly what happens to his block
 * (`ah-lyg6.4.2`, decision W3).
 *
 * A box in the flow rather than a modal, following `OrdersImportPrompt`'s own stated choice and
 * for the sharper reason here: the order text this is about to write stays visible below it, and a
 * modal over the planner would be a modal on top of a modal.
 *
 * Every word it says is `studyWritePlan`'s (`../studyOrdersWrite`); nothing is worded here.
 */
export function StudyOrdersWritePrompt({
  plan,
  onConfirm,
  onCancel
}: {
  plan: StudyWritePlan;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // A layer of its own, so Escape closes this box and the planner behind it keeps its own Escape:
  // only the topmost layer answers.
  useEscapeToDismiss(onCancel);

  const confirm = useRef<HTMLButtonElement | null>(null);
  const summonedFrom = useRef<Element | null>(null);
  if (summonedFrom.current === null) {
    summonedFrom.current = typeof document === "undefined" ? null : document.activeElement;
  }
  useEffect(() => {
    confirm.current?.focus();
    return () => {
      const current = document.activeElement;
      if (
        (current === null || current === document.body) &&
        summonedFrom.current instanceof HTMLElement
      ) {
        summonedFrom.current.focus();
      }
    };
  }, []);

  return (
    <div
      data-testid="study-orders-write-prompt"
      role="group"
      aria-label="Put these orders into your own orders?"
      className="mb-2 rounded border border-select/60 bg-raised px-2 py-1.5"
    >
      <p className="m-0 text-ink">Put these orders into your own orders?</p>
      <p className="m-0 text-ink-dim">{plan.lead}</p>
      <div className="my-1.5">
        {plan.rows.map((row) => (
          <div
            key={row.unitId}
            data-testid={`study-orders-write-row-${row.unitId}`}
            className="flex gap-2"
          >
            <span className={row.writes ? "text-ink" : "text-ink-dim"}>{row.who}</span>
            <span className={`font-mono ${row.writes ? "text-ink-soft" : "text-ink-dim"}`}>
              {row.detail}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        <button
          ref={confirm}
          type="button"
          data-testid="study-orders-write-confirm"
          disabled={plan.changed === 0}
          onClick={onConfirm}
          className="rounded border border-brass px-2.5 py-1 text-brass disabled:opacity-50"
        >
          Write orders
        </button>
        <button
          type="button"
          data-testid="study-orders-write-cancel"
          onClick={onCancel}
          className="rounded border border-edge px-2.5 py-1 text-ink-soft hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
