import { CopyButton } from "./CopyButton";
import { StudyOrdersWritePrompt } from "./StudyOrdersWritePrompt";
import type { StudyOrders } from "../studyOrders";
import type { StudyWritePlan } from "../studyOrdersWrite";

/**
 * The Orders view: one section per faction, each copyable and savable on its own (`ah-lyg6.4.1`).
 *
 * Hook-free and props-only, for the reason `StudyPlannerList` and `StudyPlannerDetail` are: a
 * component taking everything as props is one a test in this package can walk with
 * `renderToStaticMarkup`, and this package has no jsdom (ah-nass).
 */
export function StudyPlannerOrders({
  orders,
  emptyCopy,
  error,
  onSaveText,
  writePlan,
  asking,
  notice,
  onAskWrite,
  onConfirmWrite,
  onCancelWrite,
  onUndoWrite
}: {
  orders: StudyOrders;
  /**
   * What the panel says when there are no sections. `detail` is the empty string with no report
   * loaded, where one sentence says the whole of it - as `StudySchedule` does one tab away.
   */
  emptyCopy: { headline: string; detail: string };
  /** `ordersError`. */
  error: string | null;
  onSaveText: (fileName: string, text: string) => void;
  /** The own faction's write plan, or null when this tab has nothing it could write. */
  writePlan: StudyWritePlan | null;
  /** True while the confirmation stands: every section's buttons are disabled under it. */
  asking: boolean;
  /** The line about the last write of this visit, or null. */
  notice: { text: string; undoable: boolean } | null;
  onAskWrite: () => void;
  onConfirmWrite: () => void;
  onCancelWrite: () => void;
  onUndoWrite: () => void;
}) {
  return (
    <div data-testid="study-planner-orders" className="min-h-0 overflow-auto p-3">
      {error === null ? null : (
        <p
          data-testid="study-planner-orders-error"
          className="m-0 rounded border border-warn/60 bg-warn/10 px-2 py-1 text-warn"
        >
          {error}
        </p>
      )}
      {asking && writePlan !== null ? (
        <StudyOrdersWritePrompt
          plan={writePlan}
          onConfirm={onConfirmWrite}
          onCancel={onCancelWrite}
        />
      ) : null}
      {notice === null ? null : (
        <p
          data-testid="study-planner-write-notice"
          className={`m-0 flex items-center gap-2 rounded border px-2 py-1 ${
            notice.undoable
              ? "border-standing-known-edge bg-standing-known-fill text-standing-known-ink"
              : "border-edge bg-panel text-ink-dim"
          }`}
        >
          {notice.text}
          {notice.undoable ? (
            <button
              type="button"
              data-testid="study-planner-write-undo"
              onClick={onUndoWrite}
              className="rounded border border-select px-1.5 text-select hover:bg-select/15"
            >
              Undo
            </button>
          ) : null}
        </p>
      )}
      {orders.sections.length === 0 ? (
        <div
          data-testid="study-planner-orders-empty"
          className="rounded border border-edge bg-panel-raised p-3"
        >
          <p className="m-0 text-ink">{emptyCopy.headline}</p>
          {emptyCopy.detail === "" ? null : (
            <p className="text-ink-dim">{emptyCopy.detail}</p>
          )}
        </div>
      ) : (
        orders.sections.map((section, index) => (
          <section
            key={section.factionId}
            data-testid={`study-planner-orders-${section.factionId}`}
            className={`${index === 0 ? "" : "mt-3"} rounded border border-brass/60 bg-panel-raised`}
          >
            <div className="flex items-center gap-2 border-b border-brass/60 bg-brass/10 px-2 py-1">
              <span className="text-brass">{section.heading}</span>
              <span className="flex-1" />
              {/* Absent, not greyed, when nothing of yours can be written: a heading button that
                  exists in one condition only, beside a body that already says why. */}
              {section.source === "own" && writePlan !== null ? (
                <button
                  type="button"
                  data-testid="study-planner-write"
                  disabled={asking}
                  onClick={onAskWrite}
                  className="rounded border border-brass px-1.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim disabled:opacity-50"
                >
                  Put into my orders
                </button>
              ) : null}
              <CopyButton
                text={section.text}
                label="Copy"
                testId={`study-planner-copy-${section.factionId}`}
                disabled={asking}
                className="rounded border border-select px-1.5 text-select hover:bg-select/15 disabled:border-edge disabled:text-ink-dim disabled:opacity-50"
              />
              <button
                type="button"
                data-testid={`study-planner-save-${section.factionId}`}
                disabled={asking}
                onClick={() => onSaveText(section.fileName, section.text)}
                className="rounded border border-brass px-1.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim disabled:opacity-50"
              >
                Save…
              </button>
            </div>
            {/* `whitespace-pre` and a sideways scroller, not wrapping: the comment column is the
                whole point of the chosen format, and a wrapped order line reads as two orders. */}
            <div className="p-2">
              <pre className="m-0 overflow-x-auto rounded border border-edge bg-panel p-2 whitespace-pre font-mono text-ink">
                {section.text}
              </pre>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
