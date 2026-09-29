import { MAP_LEVELS, mapLevelLabel, mapSizesProblems, type MapLevel, type MapSizesDraft } from "../mapShape";

const INPUT =
  "w-full min-w-0 rounded border border-edge bg-panel-raised px-2 py-1 text-ink outline-none focus:border-brass disabled:opacity-50";
const HEADING = "text-pane-xs uppercase tracking-[0.08em] text-brass";

/**
 * The compact map-level rows and shared wrapping choices, drawn the same way when a world is
 * created and when its map sizes are edited in World settings.
 *
 * Hook-free, so both callers own the draft and tests can render it without a DOM. `testidPrefix`
 * names each field `<prefix>-<level>-width|height` and `<prefix>-wrap-x|y`.
 */
export function MapSizesFields({
  draft,
  disabled,
  testidPrefix,
  autoFocusFirst = false,
  onChange
}: {
  draft: MapSizesDraft;
  disabled: boolean;
  testidPrefix: string;
  /** Puts focus on Surface width when the fields mount, as the focused editor asks. */
  autoFocusFirst?: boolean;
  onChange: (draft: MapSizesDraft) => void;
}) {
  const setDimension = (level: MapLevel, axis: "width" | "height", value: string) =>
    onChange({ ...draft, [level]: { ...draft[level], [axis]: value } });

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
        <span className={HEADING}>Map level</span>
        <span className={HEADING}>Width</span>
        <span aria-hidden="true" />
        <span className={HEADING}>Height</span>
        {MAP_LEVELS.map((level, index) => (
          <div key={level} className="contents">
            <span className="text-ink-soft">{mapLevelLabel(level)}</span>
            <input
              data-testid={`${testidPrefix}-${level}-width`}
              aria-label={`${mapLevelLabel(level)} width`}
              inputMode="numeric"
              autoFocus={autoFocusFirst && index === 0}
              value={draft[level].width}
              disabled={disabled}
              onChange={(event) => setDimension(level, "width", event.target.value)}
              className={INPUT}
            />
            <span aria-hidden="true" className="text-ink-dim">
              ×
            </span>
            <input
              data-testid={`${testidPrefix}-${level}-height`}
              aria-label={`${mapLevelLabel(level)} height`}
              inputMode="numeric"
              value={draft[level].height}
              disabled={disabled}
              onChange={(event) => setDimension(level, "height", event.target.value)}
              className={INPUT}
            />
          </div>
        ))}
      </div>
      <WrapChoice
        testid={`${testidPrefix}-wrap-x`}
        label="Wrap east to west"
        checked={draft.wrapX}
        disabled={disabled}
        onChange={(wrapX) => onChange({ ...draft, wrapX })}
      />
      <WrapChoice
        testid={`${testidPrefix}-wrap-y`}
        label="Wrap north to south"
        checked={draft.wrapY}
        disabled={disabled}
        onChange={(wrapY) => onChange({ ...draft, wrapY })}
      />
      {mapSizesProblems(draft).map((problem) => (
        <p key={problem} role="alert" className="text-danger">
          {problem}
        </p>
      ))}
    </div>
  );
}

function WrapChoice({
  testid,
  label,
  checked,
  disabled,
  onChange
}: {
  testid: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 rounded border border-edge bg-panel px-2 py-1.5">
      <input
        data-testid={testid}
        aria-label={label}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 accent-brass"
      />
      <span className="flex flex-col">
        <span className="text-ink">{label}</span>
        <span className="text-pane-xs text-ink-dim">Applies to every map level.</span>
      </span>
    </label>
  );
}
