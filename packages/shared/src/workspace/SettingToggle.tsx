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
};

export function SettingToggle({ title, description, testId, checked, onChange }: SettingToggleProps) {
  return (
    <label className="flex items-center justify-between gap-2 text-ink-soft">
      <span>
        <span className="block">{title}</span>
        <span className="block text-pane-sm text-ink-dim">{description}</span>
      </span>
      <input
        type="checkbox"
        data-testid={testId}
        aria-label={title}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-brass"
      />
    </label>
  );
}
