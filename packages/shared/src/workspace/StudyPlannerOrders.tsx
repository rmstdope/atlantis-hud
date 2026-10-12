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
  forecastNotice = null,
  onSaveText,
  writePlan,
  asking,
  notice,
  onAskWrite,
  onConfirmWrite,
  onCancelWrite,
  onUndoWrite,
  writeCasts = true,
  onWriteCastsChange = () => {}
}: {
  orders: StudyOrders;
  /**
   * What the panel says when there are no sections. `detail` is the empty string with no report
   * loaded, where one sentence says the whole of it - as `StudySchedule` does one tab away.
   */
  emptyCopy: { headline: string; detail: string };
  /** `ordersError`. */
  error: string | null;
  /** The selected forecast basis, or null for the report-based forecast. */
  forecastNotice?: string | null;
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
  /** "Also write the casts" (ah-9qdz.4): one tick for the whole tab, drawn on every heading whose section has a cast. */
  writeCasts?: boolean;
  onWriteCastsChange?: (writeCasts: boolean) => void;
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
      {forecastNotice === null ? null : (
        <p data-testid="study-planner-orders-forecast-notice" className="m-0 text-warn">
          {forecastNotice}
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
        orders.sections.map((section, index) => {
          // Unticked with casts but no study or teach (ah-9qdz.4, mockup section 6): nothing here
          // is orders, so Copy, Save… and Put are greyed rather than offering a file of comments.
          const greyed = asking || section.withheld !== null;
          return (
          <section
            key={section.factionId}
            data-testid={`study-planner-orders-${section.factionId}`}
            className={`${index === 0 ? "" : "mt-3"} rounded border border-brass/60 bg-panel-raised`}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-brass/60 bg-brass/10 px-2 py-1">
              <span className="text-brass">{section.heading}</span>
              {/* One group, pushed right, so on a narrow window the controls wrap onto a second
                  line together rather than one at a time. */}
              <span className="ml-auto flex items-center gap-2">
              {/* Absent, not greyed, with no cast planned in this section (ah-9qdz.4). */}
              {section.hasCast ? (
                <label className="flex items-center gap-1 text-ink-soft">
                  <input
                    type="checkbox"
                    data-testid={`study-planner-write-casts-${section.factionId}`}
                    checked={writeCasts}
                    disabled={asking}
                    onChange={(event) => onWriteCastsChange(event.target.checked)}
                    className="accent-brass disabled:opacity-50"
                  />
                  Also write the casts
                </label>
              ) : null}
              {/* Absent, not greyed, when nothing of yours can be written: a heading button that
                  exists in one condition only, beside a body that already says why. */}
              {section.source === "own" && (writePlan !== null || section.withheld !== null) ? (
                <button
                  type="button"
                  data-testid="study-planner-write"
                  disabled={greyed}
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
                disabled={greyed}
                className="rounded border border-select px-1.5 text-select hover:bg-select/15 disabled:border-edge disabled:text-ink-dim disabled:opacity-50"
              />
              <button
                type="button"
                data-testid={`study-planner-save-${section.factionId}`}
                disabled={greyed}
                onClick={() => onSaveText(section.fileName, section.text)}
                className="rounded border border-brass px-1.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim disabled:opacity-50"
              >
                Save…
              </button>
              </span>
            </div>
            {/* `whitespace-pre` and a sideways scroller, not wrapping: the comment column is the
                whole point of the chosen format, and a wrapped order line reads as two orders. */}
            {section.withheld !== null ? (
              <p
                data-testid={`study-planner-orders-withheld-${section.factionId}`}
                className="m-0 p-2 text-ink-dim"
              >
                {withheldLine(section.text)}
              </p>
            ) : (
              <div className="p-2">
                <pre className="m-0 overflow-x-auto rounded border border-edge bg-panel p-2 whitespace-pre font-mono text-ink">
                  {section.text}
                </pre>
              </div>
            )}
          </section>
          );
        })
      )}
    </div>
  );
}

/** The box's name, in the ink colour, inside a withheld section's line (ah-9qdz.4, mockup section 6). */
const BOX_NAME = "Also write the casts";

function withheldLine(text: string) {
  const at = text.indexOf(BOX_NAME);
  if (at < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, at)}
      <span className="text-ink">{BOX_NAME}</span>
      {text.slice(at + BOX_NAME.length)}
    </>
  );
}
