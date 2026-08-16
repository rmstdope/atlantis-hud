/**
 * Reads the Tauri command registry out of the two places it is declared by hand, and compares
 * them to the sweep table (`tests/native/sweep.ts`) that is supposed to mirror both.
 *
 * Extracted so the lockstep the native suite already ran (`tests/native/binding.spec.ts`, before
 * ah-ga6) can also run as a plain tooling unit test, on every machine, instead of only in the
 * Linux/WebKitGTK CI job.
 */

/**
 * The frontend name of one `generate_handler!` entry: a bare ident registers under its own name
 * (`create_game` → `create_game`); a path registers a command living in core-tauri under the
 * `tauri` feature, whose last segment is its function name and whose frontend name is that minus
 * the `command_` prefix (`atlantis_hud_core_tauri::command_parse_report` → `parse_report`).
 */
export function frontendName(entry: string): string {
  const separator = entry.lastIndexOf("::");
  const ident = separator === -1 ? entry : entry.slice(separator + 2);
  return ident.startsWith("command_") ? ident.slice("command_".length) : ident;
}

/**
 * The commands `tauri::generate_handler![…]` registers, read out of `main.rs`'s own text, mapped
 * to their frontend names (see `frontendName`).
 *
 * Matches the full call, not the bare macro name, so a commented-out registration or a second
 * builder cannot shadow the real one unseen — and throws unless there is exactly one, for the
 * same reason.
 */
export function registeredCommands(mainRs: string): string[] {
  const registrations = [
    ...mainRs.matchAll(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]/gu)
  ];
  if (registrations.length !== 1) {
    throw new Error(
      `expected exactly one invoke_handler(generate_handler![...]) in main.rs, found ${registrations.length}`
    );
  }

  return registrations[0][1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(frontendName);
}

/**
 * Every `#[tauri::command(… rename = "x")]` in core-tauri, mapped from the function it sits on
 * (`command_x`) to the wire name it declares (`x`). The attribute must sit within 200 characters
 * of its `pub fn` — anything up to that many characters between them is allowed (typically just
 * `#[must_use]`, sometimes formatted across several lines) — or it is not seen, and the live test
 * then fails on the missing entry, which is the right failure.
 */
export function commandRenames(coreTauriLibRs: string): Map<string, string> {
  const renames = new Map<string, string>();
  for (const match of coreTauriLibRs.matchAll(
    /tauri::command\([^)]*rename = "([a-z_]+)"[^)]*\)\s*\)\s*\][\s\S]{0,200}?pub fn (command_[a-z_]+)\(/gu
  )) {
    renames.set(match[2], match[1]);
  }
  return renames;
}

/**
 * The commands `createTauriAdapter` invokes: every string literal passed as `invoke`'s first
 * argument, deduplicated in the order first seen. The type parameter is optional, so both
 * `invoke<T>("cmd", …)` and the untyped `invoke("cmd", …)` are found. A command name reached
 * through a variable (`invoke(command, …)`) is invisible to this — there is none in `core-client`
 * today; see `scripts/tauriCommands.test.ts` for how that is checked.
 */
export function invokedCommands(coreClientIndex: string): string[] {
  const seen = new Set<string>();
  for (const match of coreClientIndex.matchAll(/invoke(?:<[^>]*>)?\(\s*"([a-z_]+)"/gu)) {
    seen.add(match[1]);
  }
  return [...seen];
}

export interface LockstepResult {
  registeredButNotSwept: string[];
  sweptButNotRegistered: string[];
}

/** Registered but not swept, and swept but not registered — both directions, either is a bug. */
export function lockstep(registered: string[], swept: string[]): LockstepResult {
  return {
    registeredButNotSwept: registered.filter((command) => !swept.includes(command)),
    sweptButNotRegistered: swept.filter((command) => !registered.includes(command))
  };
}
