import { useEscapeToDismiss } from "./dismissLayer";
import { activatesRow, type CountLine, type ProductionRow, type ProductionView, type Tone } from "./productionView";

/**
 * The Production window (ah-nneu): every hex this turn's orders tax, pillage or produce in, against
 * the faction's region limit, with the hexes that leave work undone first.
 *
 * Built as `BattlesDialog` is - there is no shared dialog primitive - and renders only what
 * `productionView` decided. The design is `docs/ui/ah-nneu-production.html`, variant A.
 */
export function ProductionDialog({
  view,
  onSelectHex,
  onDismiss
}: {
  view: ProductionView;
  onSelectHex: (regionId: string) => void;
  onDismiss: () => void;
}) {
  useEscapeToDismiss(onDismiss);

  return (
    <div
      data-testid="production-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
    >
      <div
        data-testid="production-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Production"
        className="grid max-h-[85vh] w-[56rem] max-w-[94vw] grid-rows-[auto_auto_1fr] rounded border border-edge bg-panel-raised text-pane whitespace-normal shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
          <span className="text-ink-soft">{view.title}</span>
          <span className="flex-1" />
          <button
            type="button"
            data-testid="production-close"
            aria-label="close production"
            autoFocus
            onClick={onDismiss}
            className="rounded px-1.5 text-ink-dim hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div
          data-testid="production-counts"
          className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-2.5 pt-2 sm:grid-cols-[auto_minmax(6rem,14rem)_auto_1fr]"
        >
          {view.counts.map((line) => (
            <Count key={line.label} line={line} />
          ))}
        </div>

        <div data-testid="production-body" className="min-h-0 overflow-auto p-2.5">
          {view.empty ? (
            <p data-testid="production-empty" className="px-1 py-3 italic text-ink-dim">
              This turn's orders tax, pillage and produce nowhere.
            </p>
          ) : (
            <table className="w-full min-w-[40rem] border-collapse">
              <thead>
                <tr className="border-b border-edge text-left">
                  <th className="px-1.5 py-1 font-normal text-brass">Hex</th>
                  <th className="px-1.5 py-1 font-normal text-brass">Orders</th>
                  <th className="px-1.5 py-1 font-normal text-brass">Tax</th>
                  <th className="px-1.5 py-1 font-normal text-brass">Resources</th>
                </tr>
              </thead>
              <tbody>
                {view.gapRows.map((row) => (
                  <Row key={row.regionId} row={row} onSelectHex={onSelectHex} />
                ))}
                {view.divider !== null ? (
                  <tr data-testid="production-divider">
                    <td colSpan={4} className="px-1.5 pb-1 pt-3 text-ink-dim">
                      {view.divider}
                    </td>
                  </tr>
                ) : null}
                {view.fullRows.map((row) => (
                  <Row key={row.regionId} row={row} onSelectHex={onSelectHex} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const BAR_FILL: Record<CountLine["state"], string> = { room: "bg-select", full: "bg-brass", over: "bg-danger" };
const COUNT_TEXT: Record<CountLine["state"], string> = {
  room: "text-ink",
  full: "text-brass-bright",
  over: "text-danger"
};
const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", gap: "text-warn", estimate: "text-ink-dim" };

function Count({ line }: { line: CountLine }) {
  return (
    <div className="contents">
      <span className="text-ink-soft">{line.label}</span>
      <span className="block h-1 rounded bg-edge-soft">
        <span className={`block h-full rounded ${BAR_FILL[line.state]}`} style={{ width: `${line.fraction * 100}%` }} />
      </span>
      <span className={COUNT_TEXT[line.state]}>
        {line.used} of {line.maximum}
      </span>
      <span className={`col-span-3 sm:col-span-1 ${line.state === "over" ? "text-danger" : "text-ink-dim"}`}>
        {line.note}
      </span>
    </div>
  );
}

function Row({ row, onSelectHex }: { row: ProductionRow; onSelectHex: (regionId: string) => void }) {
  return (
    <tr
      data-testid={`production-row-${row.regionId}`}
      tabIndex={0}
      className="cursor-pointer border-b border-edge-soft hover:bg-panel focus:bg-panel focus:outline-none"
      onClick={() => onSelectHex(row.regionId)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && activatesRow(event.key)) {
          event.preventDefault();
          onSelectHex(row.regionId);
        }
      }}
    >
      <td className="whitespace-nowrap px-1.5 py-1">
        {row.terrain} <span className="text-ink-dim">{row.coordinates}</span> {row.province}
      </td>
      <td className="whitespace-nowrap px-1.5 py-1 text-ink-soft">{row.orders}</td>
      <td className={`px-1.5 py-1 ${TONE_TEXT[row.tax.tone]}`}>{row.tax.text}</td>
      <td className="px-1.5 py-1">
        {row.resources.map((cell) => (
          <span key={cell.text} className={`mr-3 whitespace-nowrap ${TONE_TEXT[cell.tone]}`}>
            {cell.text}
          </span>
        ))}
      </td>
    </tr>
  );
}
