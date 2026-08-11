import { browser, $ } from "@wdio/globals";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GAMES_DIR } from "./env";

/**
 * Getting a walk through the native shell to the point where there is a game to work in.
 *
 * These mirror the Playwright helpers in `tests/smoke`, but cannot be shared with them: the two
 * suites drive different automation protocols, and the whole point of this one is the transport
 * underneath — every call here crosses real Tauri IPC into the release binary, where the smoke
 * suite's desktop project only ever reached the WebAssembly fallback in a plain browser.
 */

export interface InvokeResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * Invokes a Tauri command over the real IPC bridge and reports how it went.
 *
 * Through `__TAURI_INTERNALS__.invoke` rather than the shared adapter, because the adapter is
 * exactly what a binding test must not trust: it was the adapter's snake_case argument names
 * against Tauri's camelCase default that once broke all twenty commands at once. Calling the
 * bridge directly with the names `main.rs` declares makes the test assert the contract itself.
 *
 * A rejection is returned rather than thrown, since for most of the sweep a domain error — an
 * unreadable database, a missing game — is a pass: the arguments bound and the command ran.
 *
 * On this webview a command rejection does not stay inside the page: it aborts the Execute
 * Async Script command in flight, carrying the rejection text as a WebDriverError, an in-page
 * `.catch` notwithstanding. The abort also consumes it — whereas a rejection that settles with
 * no script command in flight becomes sticky page state that poisons every later evaluation in
 * the session. So the invoke is deliberately kept inside `executeAsync`, and the WebDriverError
 * is converted back into a value here on the Node side, where it can no longer hurt anything.
 */
export async function invokeNative(
  command: string,
  args: Record<string, unknown> = {}
): Promise<InvokeResult> {
  try {
    return await browser.executeAsync<InvokeResult, [string, Record<string, unknown>]>(
      (cmd, cmdArgs, done) => {
        const tauri = (
          window as unknown as {
            __TAURI_INTERNALS__?: {
              invoke(name: string, payload: Record<string, unknown>): Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__;
        if (!tauri) {
          done({ ok: false, error: "__TAURI_INTERNALS__ is missing: not running under Tauri" });
          return;
        }
        tauri
          .invoke(cmd, cmdArgs)
          .then((value) => done({ ok: true, value }))
          .catch((error: unknown) => done({ ok: false, error: String(error) }));
      },
      command,
      args
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Deletes every game the shell knows about, then reloads so the frontend notices.
 *
 * The native shell keeps its registry on disk rather than in IndexedDB, so the smoke suite's
 * database-wiping approach means nothing here; asking the shell to delete each game exercises
 * the same path a user's delete does and leaves the manifest directory truly empty.
 */
export async function clearGamesNative(): Promise<void> {
  const listed = await invokeNative("list_games");
  if (!listed.ok) {
    throw new Error(`list_games failed while clearing games: ${listed.error}`);
  }
  const games = listed.value as Array<{ metadata: { gameId: string } }>;
  for (const game of games) {
    const deleted = await invokeNative("delete_game", { game_id: game.metadata.gameId });
    if (!deleted.ok) {
      throw new Error(`delete_game(${game.metadata.gameId}) failed: ${deleted.error}`);
    }
  }
  await browser.refresh();
}

/** Creates a game from the gate form and waits for the workspace to follow. */
export async function createGameUi(name: string): Promise<void> {
  await $('[data-testid="game-name"]').setValue(name);
  await $("button=Create game").click();
  await browser.waitUntil(
    async () => (await $('[data-testid="game-indicator"]').getText()).includes(name),
    { timeoutMsg: `the game indicator never showed "${name}"` }
  );
}

/**
 * Hands the report to the file input without an OS file dialog.
 *
 * WebKitWebDriver's remote file upload is not dependable, so the file is built in the page: a
 * `File` in a `DataTransfer`, assigned to the input, with a bubbling `change` event for React's
 * delegated handler. The dialog itself is browser chrome, not application code — everything from
 * the input's change handler onward runs for real, which is the same trade the smoke suite's
 * `setInputFiles` makes.
 */
export async function loadReportUi(reportText: string): Promise<void> {
  await browser.execute((text) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) {
      throw new Error("no file input on the page to receive the report");
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "turn-71.rep", { type: "text/plain" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, reportText);
  await browser.waitUntil(async () => (await importStatusText()).includes("11 regions"), {
    timeoutMsg: "the import status never reported 11 regions"
  });
}

/**
 * The import status's text as the page holds it.
 *
 * Read through `textContent` rather than WebDriver's Get Element Text, because the routine status
 * is `sr-only` - present for screen readers and suites, out of the header's way - and
 * WebKitWebDriver answers "" for text it considers invisible, where chromedriver answers the text.
 */
export async function importStatusText(): Promise<string> {
  return browser.execute(
    () => document.querySelector('[data-testid="import-status"]')?.textContent ?? ""
  );
}

/**
 * Selects a hex the way assistive technology does: focus, then Enter.
 *
 * The same path the smoke suite drives, and for the same reason — each hex is an SVG shape
 * carrying a role and a label, only the focused hex holds `tabindex="0"`, and `focus()` reaches
 * the rest regardless. It also sidesteps WebKitWebDriver's opinions about clicking SVG shapes.
 */
export async function selectHex(regionId: string): Promise<void> {
  await $(`[aria-label="hex ${regionId}"]`).waitForExist();
  // Found and focused inside the page: WebKitWebDriver hands `execute` arguments a reference
  // it cannot call `focus()` through, so the element is looked up where it can be.
  await browser.execute((label) => {
    const hex = document.querySelector(`[aria-label="${label}"]`);
    if (!hex) {
      throw new Error(`no element labelled "${label}" to focus`);
    }
    (hex as SVGElement & { focus(): void }).focus();
  }, `hex ${regionId}`);
  await browser.keys("Enter");
}

/**
 * Clicks a unit in the table, filtered down first because the table only builds the rows on
 * screen — a unit three hundred rows down is not in the page to be clicked.
 */
export async function selectUnit(unitId: string): Promise<void> {
  const filter = $('[aria-label="Filter units"]');
  await filter.setValue(unitId);
  const row = $(`[data-testid="unit-row-${unitId}"]`);
  await row.waitForDisplayed();
  await row.$("button").click();
  await filter.clearValue();
}

/**
 * Opens the one game's sidecar SQLite database, read-only, from the test process.
 *
 * This is the assertion the browser suites cannot make: the native path persists to a file, and
 * reading that file from outside the application is what proves the write actually crossed IPC
 * and reached disk rather than some in-page fallback.
 */
export function openGameDb(): DatabaseSync {
  const entries = readdirSync(GAMES_DIR, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory()
  );
  if (entries.length !== 1) {
    const names = entries.map((entry) => entry.name).join(", ") || "none";
    throw new Error(`expected exactly one game under ${GAMES_DIR}, found: ${names}`);
  }
  return new DatabaseSync(join(GAMES_DIR, entries[0].name, "game.sqlite"), { readOnly: true });
}

/**
 * Replaces the orders draft, the way `setValue` did when the editor was a textarea.
 *
 * The editor is CodeMirror now: the text lives in a contenteditable surface WebDriver's
 * `setValue` does not speak, so this goes through the keyboard - click, select everything,
 * type over it. Control rather than Meta because this suite only runs under WebKitGTK on Linux.
 */
export async function fillOrders(text: string): Promise<void> {
  const content = $('[data-testid="orders-input"] .cm-content');
  await content.waitForDisplayed();
  await content.click();
  await browser.keys(["Control", "a"]);
  await browser.keys(text);
}
