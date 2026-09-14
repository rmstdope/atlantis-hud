import type { BooleanSettingSpec } from "../booleanSettings";
import { BOOLEAN_SETTINGS, type BooleanSettingKey, useSettingsStore } from "../settingsStore";
import { SettingToggle } from "./SettingToggle";

/** One boolean setting's toggle, everything about it read from its `BOOLEAN_SETTINGS` entry. */
export function SettingFlag({ name }: { name: BooleanSettingKey }) {
  const spec: BooleanSettingSpec = BOOLEAN_SETTINGS[name];
  const checked = useSettingsStore((state) => state[name]);
  const available = useSettingsStore(
    (state) => spec.requires === undefined || state[spec.requires as BooleanSettingKey]
  );
  const setFlag = useSettingsStore((state) => state.setFlag);

  return (
    <SettingToggle
      title={spec.title}
      description={spec.description}
      testId={spec.testId}
      checked={checked}
      onChange={(value) => setFlag(name, value)}
      disabled={!available}
    />
  );
}
