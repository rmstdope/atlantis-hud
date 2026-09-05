import { CopyButton } from "./CopyButton";
import type { StudyOrders } from "../studyOrders";

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
  onSaveText
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
}) {
  return (
    <div data-testid="study-planner-orders" className="min-h-0 overflow-auto p-3">
      {error === null ? null : (
        <p data-testid="study-planner-orders-error" className="m-0 px-2 py-1 text-warn">
          {error}
        </p>
      )}
      {orders.sections.length === 0 ? (
        <div data-testid="study-planner-orders-empty">
          <p className="text-ink">{emptyCopy.headline}</p>
          {emptyCopy.detail === "" ? null : (
            <p className="text-ink-dim">{emptyCopy.detail}</p>
          )}
        </div>
      ) : (
        orders.sections.map((section) => (
          <section key={section.factionId} data-testid={`study-planner-orders-${section.factionId}`}>
            <div className="flex items-center gap-2 py-1">
              <span className="text-ink-soft">{section.heading}</span>
              <span className="flex-1" />
              <CopyButton
                text={section.text}
                label="Copy"
                testId={`study-planner-copy-${section.factionId}`}
                className="rounded border border-edge px-1.5 text-ink-dim hover:text-ink"
              />
              <button
                type="button"
                data-testid={`study-planner-save-${section.factionId}`}
                onClick={() => onSaveText(section.fileName, section.text)}
                className="rounded border border-edge px-1.5 text-ink-dim hover:text-ink"
              >
                Save…
              </button>
            </div>
            {/* `whitespace-pre` and a sideways scroller, not wrapping: the comment column is the
                whole point of the chosen format, and a wrapped order line reads as two orders. */}
            <pre className="m-0 overflow-x-auto whitespace-pre font-mono text-ink">
              {section.text}
            </pre>
          </section>
        ))
      )}
    </div>
  );
}
