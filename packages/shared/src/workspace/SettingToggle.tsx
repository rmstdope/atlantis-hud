/**
 * One checkbox row in the settings dialog: a title, a description underneath, and a checkbox that
 * applies the moment it is pressed - the dialog has no OK button to wait for.
 *
 * Extracted from `GlobalSettings`, which repeated this exact markup five times before the Warnings
 * tab needed nine more of it. The shape is unchanged: existing strings and testids survive the
 * extraction so the smoke suite does not notice.
 */
export type SettingToggleProps = {
  title: string;
  description: string;
  testId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function SettingToggle({
  title,
  description,
  testId,
  checked,
  onChange,
  disabled = false
}: SettingToggleProps) {
  return (
    <label
      className={`flex items-center justify-between gap-2 rounded border border-edge bg-panel px-2 py-1 text-ink-soft ${
        disabled ? "opacity-50" : "hover:border-brass/60"
      }`}
    >
      <span>
        <span className="block">{title}</span>
        <span className="block text-pane-sm text-ink-dim">{description}</span>
      </span>
      <input
        type="checkbox"
        data-testid={testId}
        aria-label={title}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-brass"
      />
    </label>
  );
}
