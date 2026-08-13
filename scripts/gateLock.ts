/**
 * Whether to wait for the agent holding the gate, or to conclude it is gone.
 *
 * `playwright.config.ts` carries the measurement this exists for: one worker already drives this
 * machine to about 280% CPU, and two workers broke both interactivity guards, "because a test that
 * measures how long the main thread is blocked measures contention instead". Several agents each
 * running the browser suites reproduces that off-config, and the failure is not merely slow - a
 * timing test that goes red under load gets re-run as "infrastructure", so either the loop burns
 * wall-clock or a retry-green means somebody merged on a measurement they never satisfied.
 *
 * The decision lives apart from the waiting so the crash case can be stated plainly. A lock nobody
 * can steal is worse than no lock at all: one agent dying mid-gate would stop every other agent on
 * the machine until a human noticed.
 */

/** Who holds the gate, as written into the lock file. */
export type Holder = {
  pid: number;
  /** When they took it, in epoch milliseconds. */
  since: number;
  /** What they are running, so a wait can say what it is waiting for. */
  what: string;
};

/**
 * How long a holder is believed before it is treated as a ghost.
 *
 * The whole gate is minutes. An hour is not a slow run; it is a pid that has been reused by an
 * unrelated process, which `alive` cannot tell apart from the real holder.
 */
export const LOCK_TTL_MS = 60 * 60 * 1000;

/** What the lock file says, or nothing when it says nothing readable. */
export function parseHolder(text: string): Holder | null {
  try {
    const held = JSON.parse(text) as Partial<Holder>;
    const readable =
      typeof held.pid === "number" &&
      typeof held.since === "number" &&
      typeof held.what === "string";

    return readable ? (held as Holder) : null;
  } catch {
    // A holder killed mid-write leaves a partial file. Unreadable is the same as absent: a gate
    // that threw here would be one more way to block the machine.
    return null;
  }
}

/** Whether the lock can be taken despite the file being there. */
export function shouldSteal(
  holder: Holder | null,
  alive: (pid: number) => boolean,
  now: number
): boolean {
  if (holder === null) {
    return true;
  }
  if (!alive(holder.pid)) {
    return true;
  }

  return now - holder.since > LOCK_TTL_MS;
}

/** What to say while waiting, so a queued run is never a mystery. */
export function describeHolder(holder: Holder, waitedMs: number): string {
  const seconds = Math.round(waitedMs / 1000);
  const held = seconds >= 60 ? `${Math.floor(seconds / 60)}m${seconds % 60}s` : `${seconds}s`;

  return `gate: waiting ${held} for pid ${holder.pid}, running ${holder.what}`;
}

/** Whether a process is still there, without signalling it. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to somebody else, which is still "there".
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
