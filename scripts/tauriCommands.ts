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
 * Splits `text` on commas at nesting depth zero of `<>`, `()`, `[]` and `{}`; trims each piece;
 * drops empties. A parameter list read out of Rust or TypeScript source can itself contain commas
 * inside a generic (`HashMap<K, V>`) or an object type (`Record<string, unknown>`), and a plain
 * `.split(",")` would miscount those as separate parameters.
 */
export function splitTopLevel(text: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "<" || char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ">" || char === ")" || char === "]" || char === "}") {
      depth -= 1;
    }
    if (char === "," && depth === 0) {
      pieces.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  pieces.push(current.trim());
  return pieces.filter((piece) => piece.length > 0);
}

/** One wire parameter of a Tauri command. */
export interface CommandParameter {
  /** The wire name, exactly as a caller must send it. */
  name: string;
  /**
   * False when the Rust type is written literally as `Option<…>`, which Tauri lets a caller omit;
   * true otherwise. The test is textual rather than semantic, so a spelling no command uses today
   * (`std::option::Option<…>`, a type alias) would read as required — which fails strict, asking
   * the sweep for an argument it could have omitted, rather than letting a missing one through.
   *
   * A required parameter that nothing sends is `missing required key <name>` at runtime, and
   * before ah-enik that was only ever seen in CI's Linux-only `native` job (ah-0w7w).
   */
  required: boolean;
}

/**
 * Reads one `name: Type` piece of a Rust parameter list.
 *
 * Split on the **first** `:` only: the name is the half before it and the type the half after.
 * Splitting on every `:` would put `Foo::Bar`'s tail in the type half; the name half was always
 * correct, but the type half is what is new here.
 *
 * Only a parameter list ever reaches this — never a return type — because both callers capture with
 * `\(([^)]*)\)`, which stops at the first `)`. That is what keeps `command_load_order_draft`'s
 * `Result<Option<OrderDraftRecordDto>, String>` from making a required parameter look optional, and
 * it is why that capture must not be widened. (It also truncates a parameter list containing its
 * own `)`, which no command has; such a list would drop its later parameters and fail the
 * `TAURI_COMMANDS` key check rather than pass quietly.)
 */
function readParameter(piece: string): CommandParameter {
  const separator = piece.indexOf(":");
  const name = (separator === -1 ? piece : piece.slice(0, separator)).trim();
  const type = separator === -1 ? "" : piece.slice(separator + 1).trim();
  return { name, required: !type.startsWith("Option<") };
}

/**
 * The wire parameters of every Tauri command, in declaration order, keyed by frontend name.
 *
 * From `main.rs`: each `#[tauri::command(rename_all = "snake_case")] fn name(params)`, minus an
 * `app: tauri::AppHandle` parameter (the shell's own, not the frontend's). From core-tauri: each
 * `pub fn command_x(params)` that `commandRenames` maps, read under its renamed (wire) name.
 *
 * A wire name declared by both sides is a bug — main.rs and core-tauri each register a distinct
 * set of commands, so an overlap means one of them has drifted — and this throws rather than
 * silently letting one shadow the other.
 */
export function commandParameters(
  mainRs: string,
  coreTauriLibRs: string
): Record<string, CommandParameter[]> {
  const parameters: Record<string, CommandParameter[]> = {};

  for (const match of mainRs.matchAll(
    /#\[tauri::command\(rename_all = "snake_case"\)\]\s*(?:pub\s+)?fn\s+([a-z_]+)\s*\(([^)]*)\)/gu
  )) {
    const [, name, params] = match;
    parameters[name] = splitTopLevel(params)
      .map(readParameter)
      .filter((parameter) => parameter.name !== "app");
  }

  for (const [fn, wire] of commandRenames(coreTauriLibRs)) {
    if (Object.prototype.hasOwnProperty.call(parameters, wire)) {
      throw new Error(`"${wire}" is declared by both main.rs and core-tauri (via ${fn})`);
    }
    const signature = new RegExp(String.raw`pub fn ${fn}\(([^)]*)\)`, "u").exec(coreTauriLibRs);
    if (!signature) {
      throw new Error(`could not find the signature of ${fn} in core-tauri's lib.rs`);
    }
    parameters[wire] = splitTopLevel(signature[1]).map(readParameter);
  }

  return parameters;
}

/** `#[wasm_bindgen] pub fn name(params)` in core-wasm: name → parameter count. */
export function wasmExports(coreWasmLibRs: string): Record<string, number> {
  const exports: Record<string, number> = {};
  for (const match of coreWasmLibRs.matchAll(/#\[wasm_bindgen\]\s*pub fn ([a-z_]+)\s*\(([^)]*)\)/gu)) {
    exports[match[1]] = splitTopLevel(match[2]).length;
  }
  return exports;
}

/** The members of `export type CoreWasmModule = { … };` in webCoreAdapter.ts: name → parameter count. */
export function wasmModuleMembers(webCoreAdapterTs: string): Record<string, number> {
  const start = webCoreAdapterTs.indexOf("export type CoreWasmModule = {");
  if (start === -1) {
    throw new Error("could not find \"export type CoreWasmModule = {\" in webCoreAdapter.ts");
  }
  const end = webCoreAdapterTs.indexOf("\n};", start);
  if (end === -1) {
    throw new Error('could not find the closing "\\n};" of CoreWasmModule in webCoreAdapter.ts');
  }
  const block = webCoreAdapterTs.slice(start, end);

  const members: Record<string, number> = {};
  for (const match of block.matchAll(/^\s+([a-z_]+)\(([\s\S]*?)\):/gmu)) {
    members[match[1]] = splitTopLevel(match[2]).length;
  }
  return members;
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
