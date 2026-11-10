import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
import {
  clearGames,
  createGame,
  expectOrders,
  fillOrders,
  importReport,
  loadReport,
  ordersInput,
  saveNow,
  selectHex,
  selectUnit
} from "./gameSetup";
import { DESKTOP_SHELL_TAG } from "./shells";

/**
 * The panel that shows what an assistant wrote (ah-bcdri), and the assistant asking what the player
 * edited since it last looked (ah-a97xg.10). Tagged for `desktop-shell`: only the
 * desktop bundle passes an assistant transport, and this walk installs a stand-in for it.
 *
 * Every rule and every word is pinned in `assistantChanges.test.ts` and
 * `AssistantChangesPanel.test.tsx`. What is here is what a static render cannot reach: who holds the
 * cursor, Esc, dragging, the narrow sheet, and coming back after a reload.
 */

type Answer = { text: string; isError: boolean };

declare global {
  interface Window {
    __assistantCall?: (name: string, args: Record<string, unknown>) => Promise<Answer>;
  }
}

const TURN_70 = readReport("g7f95t70");
const TURN_71 = readReport("g7f95t71");

const MAGE = "881";
const MAGE_HEX = "1:26,52";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let onCall: ((call: { id: number; name: string; arguments: Record<string, unknown> }) => Promise<Answer>) | null = null;
    let id = 0;
    (window as unknown as { __ATLANTIS_DESKTOP_ASSISTANT__: unknown }).__ATLANTIS_DESKTOP_ASSISTANT__ = {
      async connect(_tools: unknown, handler: typeof onCall) {
        onCall = handler;
        return () => undefined;
      },
      async connection() {
        return { url: "http://127.0.0.1:1/mcp", token: "stand-in", error: null };
      }
    };
    window.__assistantCall = (name, args) => {
      if (onCall === null) {
        throw new Error("the assistant is not connected yet");
      }
      id += 1;
      return onCall({ id, name, arguments: args });
    };
  });
});

async function call(page: Page, name: string, args: Record<string, unknown> = {}): Promise<Answer> {
  return page.evaluate(([tool, input]) => window.__assistantCall?.(tool as string, input as Record<string, unknown>) as Promise<Answer>, [name, args] as const);
}

async function turnKey(page: Page): Promise<string> {
  await expect.poll(async () => (await call(page, "get_turn_overview")).isError).toBe(false);
  return (JSON.parse((await call(page, "get_turn_overview")).text) as { turnKey: string }).turnKey;
}

/** Writes `orders` for `unitId`, the way the assistant's `set_unit_orders` does. */
async function write(page: Page, key: string, unitId: string, orders: string) {
  const answer = await call(page, "set_unit_orders", { turnKey: key, unitId, orders });
  expect(answer.isError, answer.text).toBe(false);
}

/** The faction's own units, so a walk need not know the fixture by heart. */
async function ownUnits(page: Page, count: number): Promise<string[]> {
  const rows = JSON.parse((await call(page, "list_units")).text) as { unitId: string }[];
  return rows.map((row) => row.unitId).filter((unitId) => unitId !== MAGE).slice(0, count);
}

const panel = (page: Page) => page.getByTestId("assistant-changes-panel");
const chip = (page: Page) => page.getByTestId("assistant-changes-chip");
const count = (page: Page) => page.getByTestId("assistant-changes-count");
const entry = (page: Page, unitId: string) => page.getByTestId(`assistant-change-${unitId}`);

async function openOnMage(page: Page) {
  await loadReport(page);
  await selectHex(page, MAGE_HEX);
  await selectUnit(page, MAGE);
  return turnKey(page);
}

test(
  "writes show as they land without taking the cursor, and can be taken back",
  { tag: DESKTOP_SHELL_TAG },
  async ({ page }) => {
    const key = await openOnMage(page);
    const [first, second, third] = await ownUnits(page, 3);
    await ordersInput(page).click();
    await expect(panel(page)).toHaveCount(0);

    await write(page, key, first as string, "work");
    await expect(panel(page)).toBeVisible();
    await expect(count(page)).toHaveText("1 unit");
    await expect(ordersInput(page)).toBeFocused();

    // A write to the very unit being typed in lands, keeps the cursor, and says so.
    await fillOrders(page, "study FORC");
    // A write that changes nothing says nothing.
    await write(page, key, MAGE, "study FORC");
    await expect(page.getByTestId("orders-assistant-rewrote")).toHaveCount(0);
    await write(page, key, MAGE, "study PATT");
    await expectOrders(page, /study PATT/u);
    await expect(page.getByTestId("orders-assistant-rewrote")).toBeVisible();
    await expect(ordersInput(page)).toBeFocused();
    await expect(entry(page, MAGE)).toContainText("study FORC");
    await page.keyboard.type(" ");
    await expect(page.getByTestId("orders-assistant-rewrote")).toHaveCount(0);

    // A hand edit marks it; typing back to what the assistant wrote takes the mark away.
    await expect(entry(page, MAGE)).toContainText("edited since");
    await page.keyboard.press("Backspace");
    await expect(entry(page, MAGE)).not.toContainText("edited since");

    // Revert one, and the panel keeps the cursor.
    await page.getByTestId(`assistant-change-revert-${first as string}`).click();
    await expect(entry(page, first as string)).toHaveCount(0);
    await expect(panel(page)).toBeFocused();

    // Revert all asks, and Esc in the question is Cancel.
    await write(page, key, second as string, "work");
    await write(page, key, third as string, "work");
    await page.getByTestId("assistant-changes-revert-all").click();
    const question = page.getByTestId("assistant-changes-question");
    await expect(question).toContainText("Revert 3 units?");
    await expect(page.getByTestId("assistant-changes-cancel")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(question).toHaveCount(0);
    await expect(panel(page)).toBeVisible();

    await page.getByTestId("assistant-changes-revert-all").click();
    await page.getByTestId("assistant-changes-confirm").click();
    await expect(panel(page)).toHaveCount(0);
    await expectOrders(page, /study FORC/u);
  }
);

test(
  "a closed panel stays closed, comes back as it was left, and moves or docks with the window",
  { tag: DESKTOP_SHELL_TAG },
  async ({ page }) => {
    const key = await openOnMage(page);
    const [first, second] = await ownUnits(page, 2);
    await write(page, key, first as string, "work");
    await expect(panel(page)).toBeVisible();

    // Dragged by its top bar, like the app's dialogs.
    const bar = page.getByTestId("assistant-changes-bar");
    const before = (await panel(page).boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    await page.mouse.move(barBox.x + 200, barBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(barBox.x + 260, barBox.y - 40, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await panel(page).boundingBox())!.x).toBeGreaterThan(before.x + 30);

    // Esc from inside closes it, and the cursor lands on the chip.
    await page.getByTestId("assistant-changes-keep-all").focus();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(chip(page)).toContainText("Assistant: 1");
    await expect(chip(page)).toBeFocused();

    // Closed stays closed while the number rises.
    await write(page, key, second as string, "work");
    await expect(chip(page)).toContainText("Assistant: 2");
    await expect(panel(page)).toBeHidden();

    // The list comes back, still closed, after a reload.
    await saveNow(page);
    await page.reload();
    await expect(chip(page)).toContainText("Assistant: 2");
    await expect(panel(page)).toBeHidden();

    // The chip brings it back and gives it the cursor.
    await chip(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toBeFocused();
    await expect(chip(page)).toHaveCount(0);
    await expect(count(page)).toHaveText("2 units");

    // The command list reaches it too, and it is only listed while something is.
    await page.getByTestId("assistant-changes-close").click();
    await expect(chip(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("palette-input").fill("Show assistant changes");
    await expect(page.getByTestId("palette-item")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toBeFocused();

    // A narrow window makes it a sheet across the bottom that cannot be dragged.
    await page.setViewportSize({ width: 700, height: 720 });
    await expect(panel(page)).toHaveAttribute("data-sheet", "");
    const sheet = (await panel(page).boundingBox())!;
    expect(sheet.width).toBe(700);
    expect(sheet.y + sheet.height).toBe(720);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(panel(page)).not.toHaveAttribute("data-sheet", "");

    // Dragged and full, it stays inside the window and scrolls; a new entry above holds the list still.
    const rows = (JSON.parse((await call(page, "list_units")).text) as { unitId: string; regionId: string }[])
      .filter((row) => row.regionId.startsWith("1:") && row.unitId !== first && row.unitId !== second)
      .map((row) => ({ ...row, at: row.regionId.slice(2).split(",").map(Number) as [number, number] }))
      .sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || Number(a.unitId) - Number(b.unitId));
    const [topmost, ...rest] = rows;
    for (const row of rest.slice(0, 12)) {
      await write(page, key, row.unitId, "work");
    }
    await expect.poll(async () => {
      const box = (await panel(page).boundingBox())!;
      return box.y + box.height;
    }).toBeLessThanOrEqual(720);
    const list = page.getByTestId("assistant-changes-list");
    await list.evaluate((element) => element.scrollTo(0, 400));
    const reading = page.locator("[data-testid^='assistant-change-'][data-unit]").nth(3);
    const readingId = await reading.getAttribute("data-unit");
    const seen = page.getByTestId(`assistant-change-${readingId as string}`);
    const topBefore = (await seen.boundingBox())!.y;
    await write(page, key, (topmost as { unitId: string }).unitId, "work");
    await expect(entry(page, (topmost as { unitId: string }).unitId)).toHaveCount(1);
    await expect.poll(async () => Math.round((await seen.boundingBox())!.y)).toBe(Math.round(topBefore));

    // Keep all empties it for good; nothing to bring back.
    await page.getByTestId("assistant-changes-keep-all").click();
    await expect(panel(page)).toHaveCount(0);
    await expect(chip(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("app-header")).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
  }
);

/** Drags one of the panel's resize edges by (dx, dy), from the middle of its grab band. */
async function dragEdge(page: Page, edge: string, dx: number, dy: number, whileHeld?: () => Promise<void>) {
  const handle = page.getByTestId(`assistant-changes-resize-${edge}`);
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await whileHeld?.();
  await page.mouse.up();
}

const frame = async (page: Page) => (await panel(page).boundingBox())!;

test(
  "the panel resizes from its edges, fits its entries up to that size, and resets on a double-click",
  { tag: DESKTOP_SHELL_TAG },
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const key = await openOnMage(page);
    const units = await ownUnits(page, 13);
    await write(page, key, units[0] as string, "work");
    await expect(panel(page)).toBeVisible();
    const original = await frame(page);

    // The right edge widens it, and the held edge lights up while the button is down.
    await dragEdge(page, "e", 100, 0, async () => {
      await expect(page.getByTestId("assistant-changes-resize-e")).toHaveAttribute("data-active", "");
    });
    await expect(page.getByTestId("assistant-changes-resize-e")).not.toHaveAttribute("data-active", "");
    await expect.poll(async () => Math.round((await frame(page)).width)).toBe(Math.round(original.width + 100));

    // The top edge follows the pointer while held; let go and one entry still fits with no space below.
    await dragEdge(page, "n", 0, -150, async () => {
      await expect.poll(async () => Math.round((await frame(page)).height)).toBe(Math.round(original.height + 150));
    });
    await expect.poll(async () => Math.round((await frame(page)).height)).toBe(Math.round(original.height));
    const limit = original.height + 150;

    // More units grow it to the size set, and from there the list scrolls.
    for (const unitId of units.slice(1)) {
      await write(page, key, unitId, "work");
    }
    await expect(count(page)).toHaveText(`${String(units.length)} units`);
    await expect.poll(async () => Math.round((await frame(page)).height)).toBe(Math.round(limit));
    const list = page.getByTestId("assistant-changes-list");
    expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

    // The left edge moves the left side and keeps the right one.
    const right = (await frame(page)).x + (await frame(page)).width;
    await dragEdge(page, "w", 50, 0);
    await expect.poll(async () => Math.round((await frame(page)).x)).toBe(Math.round(original.x + 50));
    expect(Math.round((await frame(page)).x + (await frame(page)).width)).toBe(Math.round(right));

    // It will not go narrower than its smallest width.
    await dragEdge(page, "e", -2000, 0);
    await expect.poll(async () => Math.round((await frame(page)).width)).toBe(320);

    // Closed to the chip and reopened, it keeps the size.
    await page.getByTestId("assistant-changes-close").click();
    await chip(page).click();
    await expect(panel(page)).toBeVisible();
    expect(Math.round((await frame(page)).width)).toBe(320);
    expect(Math.round((await frame(page)).height)).toBe(Math.round(limit));

    // A window too short for it shrinks it, and the size comes back with the room.
    await page.setViewportSize({ width: 1280, height: 400 });
    await expect.poll(async () => {
      const box = await frame(page);
      return box.y + box.height;
    }).toBeLessThanOrEqual(400);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect.poll(async () => Math.round((await frame(page)).height)).toBe(Math.round(limit));

    // A double-click on an edge puts the size back and leaves the panel where it is.
    const placed = await frame(page);
    await page.getByTestId("assistant-changes-resize-e").dblclick();
    await expect.poll(async () => Math.round((await frame(page)).width)).toBe(Math.round(original.width));
    expect(Math.round((await frame(page)).x)).toBe(Math.round(placed.x));
    expect(Math.round((await frame(page)).y)).toBe(Math.round(placed.y));

    // The narrow sheet resizes from its top edge, and keeps its height apart from the window's size.
    await dragEdge(page, "e", 60, 0);
    await expect.poll(async () => Math.round((await frame(page)).width)).toBe(Math.round(original.width + 60));
    await page.setViewportSize({ width: 700, height: 720 });
    await expect(panel(page)).toHaveAttribute("data-sheet", "");
    await expect(page.locator("[data-testid^='assistant-changes-resize-']")).toHaveCount(1);
    const sheet = await frame(page);
    await dragEdge(page, "n", 0, 100);
    await expect.poll(async () => Math.round((await frame(page)).height)).toBe(Math.round(sheet.height - 100));
    expect(Math.round((await frame(page)).y + (await frame(page)).height)).toBe(720);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect.poll(async () => Math.round((await frame(page)).width)).toBe(Math.round(original.width + 60));
    await page.setViewportSize({ width: 700, height: 720 });
    await expect.poll(async () => Math.round((await frame(page)).height)).toBe(Math.round(sheet.height - 100));
    await page.getByTestId("assistant-changes-resize-n").dblclick();
    await expect.poll(async () => Math.round((await frame(page)).height)).toBe(Math.round(sheet.height));
  }
);

test(
  "the list empties for good when a new turn opens",
  { tag: DESKTOP_SHELL_TAG },
  async ({ page }) => {
    await clearGames(page);
    await createGame(page, "Assistant turns game");
    await importReport(page, "turn70.txt", TURN_70);
    const key = await turnKey(page);
    const [first] = await ownUnits(page, 1);
    await write(page, key, first as string, "work");
    await expect(panel(page)).toBeVisible();

    await importReport(page, "turn71.txt", TURN_71);

    await expect(panel(page)).toHaveCount(0);
    await expect(chip(page)).toHaveCount(0);
  }
);

test(
  "the assistant can ask which units the player edited since it read them",
  { tag: DESKTOP_SHELL_TAG },
  async ({ page }) => {
    await openOnMage(page);
    const read = await call(page, "get_orders", { unitId: MAGE });
    expect(read.isError, read.text).toBe(false);

    await fillOrders(page, "study PATT");

    await expect
      .poll(async () => JSON.parse((await call(page, "list_order_edits")).text) as unknown)
      .toEqual({ edits: [expect.objectContaining({ unitId: MAGE, before: read.text, now: "study PATT" })] });
  }
);
