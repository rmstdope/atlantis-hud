/**
 * The one path every async shell action runs through (ah-k6i, ah-6l2).
 *
 * `AppShell` fires each async handler with `void`, so nothing else awaits it or sees it reject -
 * whatever the handler does with a failure is the only chance the player has to hear about it.
 * `handleOpenTurnPicker` forgot (ah-k6i.1), the same way `handleSelectComparisonTurn` once did
 * (ah-6l2): an unhandled rejection with no message on screen. `runReported` makes that mistake
 * impossible to repeat - a handler that goes through it cannot fail silently, whatever it does.
 * Later slices of ah-k6i move handler bodies out of `AppShell.tsx` by feature and call this.
 */

/**
 * Turns whatever was thrown into something a user can act on.
 *
 * Tauri rejects with a plain string rather than an Error, so checking `instanceof Error` alone
 * discards the only useful detail and leaves "unknown error" on screen.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  try {
    return JSON.stringify(error) ?? "unknown error";
  } catch {
    return "unknown error";
  }
}

export type FailureReporter = (message: string) => void;

export type RunReportedOptions = {
  /** Called with `true` before `work` starts and `false` once it has settled - a busy flag. */
  busy?: (busy: boolean) => void;
  /** Put in front of the described error, joined with ": " - e.g. "could not import turn.rep". */
  prefix?: string;
};

/**
 * Runs an async shell action so that `work` throwing cannot fail silently: the rejection is
 * described and handed to `report` (with `prefix` in front when given), `busy` is released
 * whatever `work` did, and the returned promise resolves rather than rejects. Resolves with the
 * work's value, or `undefined` when it threw. The shell fires it as `void runReported(...)` from a
 * JSX handler - the `void` is then safe against a `work` failure.
 *
 * `report` itself throwing is a programming error, not a `work` failure, and is allowed to
 * propagate rather than being swallowed here.
 */
export async function runReported<T>(
  work: () => Promise<T>,
  report: FailureReporter,
  options?: RunReportedOptions
): Promise<T | undefined> {
  try {
    options?.busy?.(true);
    return await work();
  } catch (error) {
    const message = describeError(error);
    report(options?.prefix ? `${options.prefix}: ${message}` : message);
    return undefined;
  } finally {
    options?.busy?.(false);
  }
}
