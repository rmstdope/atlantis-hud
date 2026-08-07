export type FeatureFlags = {
  enableStructuredLoggingDemo: boolean;
};

const DEFAULT_FLAGS: FeatureFlags = {
  enableStructuredLoggingDemo: true
};

type FlagSource = Partial<FeatureFlags> | undefined;

const envKeyToFlag: Record<string, keyof FeatureFlags> = {
  ATLANTIS_FLAG_ENABLE_STRUCTURED_LOGGING_DEMO: "enableStructuredLoggingDemo"
};

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return undefined;
}

export function resolveFeatureFlags(fileFlags?: FlagSource, env?: Record<string, unknown>): FeatureFlags {
  const resolved: FeatureFlags = {
    ...DEFAULT_FLAGS,
    ...(fileFlags ?? {})
  };

  if (!env) {
    return resolved;
  }

  for (const [envKey, flagName] of Object.entries(envKeyToFlag)) {
    const parsed = parseBoolean(env[envKey]);
    if (parsed !== undefined) {
      resolved[flagName] = parsed;
    }
  }

  return resolved;
}
