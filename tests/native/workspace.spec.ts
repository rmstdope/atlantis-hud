import { readFileSync } from "node:fs";
import { join } from "node:path";
import { browser, $, expect } from "@wdio/globals";
import {
  clearGamesNative,
  createGameUi,
  fillOrders,
  importStatusText,
  loadReportUi,
  openGameDb,
  selectHex,
  selectUnit
} from "./helpers";

/**
 * The issue's three test vectors, driven through the real desktop application.
 *
 * Deliberately not another walk of the widgets — the Playwright suite already does that against
 * both shells. What only this suite can see is the transport and the storage underneath: every
 * interaction here crosses Tauri IPC into the release binary, and the import lands in a SQLite
 * file this test opens from the outside, which is exactly the side of the desktop path no
 * browser-hosted test has ever reached.
 */

const REPORT = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-g7-f95-t71.rep"),
  "utf8"
);

/** Inholm's own unit, the same one the smoke suite edits. */
const OWN_UNIT = "18642";

describe("native desktop workspace", () => {
  before(async () => {
    await clearGamesNative();
  });

  it("imports the turn 71 report and persists it to the sidecar database", async () => {
    await $('[data-testid="game-gate"]').waitForDisplayed();
    await createGameUi("Native game");
    await loadReportUi(REPORT);

    // Through textContent, not Get Element Text: the routine status is sr-only and
    // WebKitWebDriver reports hidden text as empty.
    expect(await importStatusText()).toContain("11 regions");
    await expect($('[data-testid="app-header"]')).toHaveText(
      expect.stringContaining("Borg TNG (95)")
    );
    await expect($('[data-testid="app-header"]')).toHaveText(expect.stringContaining("71"));

    // The half the browser suites cannot see: the turn is a row in a file on disk, not an
    // IndexedDB entry, and it is readable from outside the application. Polled, because the
    // shell holds the writing connection and a reader can land inside its transaction.
    await browser.waitUntil(
      () => {
        const db = openGameDb();
        try {
          const rows = db
            .prepare("SELECT faction_id, turn_number FROM imported_turns ORDER BY turn_number")
            .all();
          return (
            rows.length === 1 && rows[0].faction_id === "95" && rows[0].turn_number === 71
          );
        } finally {
          db.close();
        }
      },
      { timeoutMsg: "imported_turns never held exactly the row (95, 71)" }
    );
  });

  it("selecting hex 1:7,53 lists its ninety-two units", async () => {
    await selectHex("1:7,53");
    await expect($('[data-testid="panel-units"]')).toHaveText(
      expect.stringContaining("92 units")
    );
  });

  it("exports edited orders with the #atlantis header intact", async () => {
    await selectUnit(OWN_UNIT);
    await fillOrders("@work");
    await expect($('[data-testid="orders-status"]')).toHaveText(
      expect.stringContaining("0 errors")
    );

    // Orders export now goes through the native save dialog (ah-7pa), which is an OS window
    // WebDriver cannot see, let alone drive - it lives entirely outside the webview. So this
    // stubs the two Tauri IPC calls the dialog and the write go through instead of exercising
    // the real dialog: `plugin:dialog|save` resolves with a fixed path as if the player had
    // chosen one, and `plugin:fs|write_text_file` captures the bytes it was asked to write.
    // Everything else still goes to the real invoke, so the rest of the app is untouched.
    await browser.execute(() => {
      const scope = window as unknown as { __exportCaptures?: string[] };
      scope.__exportCaptures = [];
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const original = internals.invoke.bind(internals);
      internals.invoke = (cmd: string, args?: unknown, options?: unknown) => {
        if (cmd === "plugin:dialog|save") {
          return Promise.resolve("/tmp/native-orders-export.txt");
        }
        if (cmd === "plugin:fs|write_text_file") {
          const text = new TextDecoder().decode(args as Uint8Array);
          scope.__exportCaptures?.push(text);
          return Promise.resolve(null);
        }
        return original(cmd, args, options);
      };
    });

    // Both exports live behind one header button now, so the menu is opened first. By test id
    // rather than by text: the trigger's text carries a chevron beside the word, and what a text
    // selector makes of that is the driver's business rather than something to bet a suite on.
    await $('[data-testid="export-menu"]').click();
    await $('[data-testid="export-orders"]').click();

    await browser.waitUntil(
      async () => {
        const captures = await browser.execute(
          () => (window as unknown as { __exportCaptures?: string[] }).__exportCaptures ?? []
        );
        return captures.length > 0;
      },
      { timeoutMsg: "the export never wrote through plugin:fs|write_text_file" }
    );

    const exported = await browser.execute(
      () => (window as unknown as { __exportCaptures?: string[] }).__exportCaptures?.[0] ?? null
    );

    if (exported === null) {
      throw new Error("the export never wrote through plugin:fs|write_text_file");
    }
    expect(exported.startsWith("#atlantis")).toBe(true);
    expect(exported).toContain("@work");

    // The edit also has to survive as a draft in the sidecar database. Polled, because the
    // shell is free to flush drafts asynchronously; read-only, because the shell holds the
    // writing connection.
    await browser.waitUntil(
      () => {
        const db = openGameDb();
        try {
          const row = db
            .prepare("SELECT order_text FROM order_drafts WHERE faction_id = ?")
            .get("95") as { order_text?: string } | undefined;
          return Boolean(row?.order_text?.includes("@work"));
        } finally {
          db.close();
        }
      },
      { timeoutMsg: "no order draft containing @work ever reached order_drafts" }
    );
  });
});
