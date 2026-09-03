import { expect, test, type Page } from "@playwright/test";
import {
  clearGames,
  createGame,
  expectOrders,
  expectOrdersNot,
  fillOrders,
  loadReport,
  ordersInput,
  selectHex,
  selectUnit
} from "./gameSetup";
import { readReport } from "@atlantis/fixtures";

/**
 * The orders editor itself: undo, completion, and diagnostics in the margin (#89).
 *
 * These walks are about the editing surface rather than about what the orders mean, which
 * workspace.spec.ts already covers. They exist because the editor is CodeMirror now, and every
 * behaviour here - history, the completion popup, the lint gutter - is configuration that a
 * refactor could drop without any other test noticing.
 */

/** "Seven of Eight", the player's unit in Inholm at (7,53). */
const OWN_UNIT = "18642";
/** Another of the player's units, in the mountain at (26,52) - a different editor entirely. */
const OTHER_OWN_UNIT = "13401";

/**
 * Where the first character actually starts: `.cm-line`'s own bounding box is its border edge,
 * not its text - the line's `padding-left` (2px, per gh-205) sits between the two. Measuring the
 * box alone would let the budget pass while the text itself sat further right than agreed.
 */
async function textStartX(line: ReturnType<Page["locator"]>) {
  const box = await line.boundingBox();
  expect(box).not.toBeNull();
  const paddingLeft = await line.evaluate((element) =>
    parseFloat(getComputedStyle(element).paddingLeft)
  );
  return box!.x + paddingLeft;
}

/** A loaded game with OWN_UNIT selected and its orders on screen - where every walk here starts. */
async function openEditor(page: Page) {
  await loadReport(page, "Editor smoke");
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
}

test("typing can be undone and redone from the keyboard", async ({ page }) => {
  await openEditor(page);

  await fillOrders(page, "@work");
  await expectOrders(page, /@work/);
  // History groups edits that land within half a second of each other; standing well clear of
  // that window is what makes "one undo, one step" deterministic rather than a race.
  await page.waitForTimeout(700);
  // The second edit is typed rather than filled: keystrokes are what the history feature
  // serves, and a whole-draft replacement is a burst of mutations whose echoes can still be
  // crossing React while the next assertion reads the editor.
  const orders = ordersInput(page);
  await orders.click();
  await orders.press("ControlOrMeta+a");
  await orders.press("ArrowRight");
  await orders.press("Enter");
  await orders.pressSequentially("TAX");
  await expectOrders(page, /TAX/);

  await ordersInput(page).press("ControlOrMeta+z");
  await expectOrders(page, /^@work\n?$/);

  // Capital Z, deliberately: a real keyboard reports key "Z" for this chord, and CodeMirror
  // resolves the binding from that. Lowercase "z" here made Playwright synthesize an event no
  // keyboard produces - ctrl+shift with key "z" - whose first lookup candidate is Ctrl-z, which
  // is undo: the chord stepped BACKWARD, deterministically, on any non-mac platform.
  await ordersInput(page).press("ControlOrMeta+Shift+Z");
  await expectOrders(page, /TAX/);
});

test("undo cannot resurrect another unit's orders", async ({ page }) => {
  await openEditor(page);

  await fillOrders(page, "@work");
  await expectOrders(page, /@work/);

  await selectHex(page, "1:26,52");
  await selectUnit(page, OTHER_OWN_UNIT);
  // The second unit's own template orders, exactly as the report wrote them. Asserting the
  // verbatim text matters: an undo that rewound into 18642's draft, into an intermediate splice,
  // or into an empty editor would each leave something different here, and a looser "does not
  // contain @work" passed while one of those bugs existed.
  await expectOrders(page, /^@prepare staf\n@study comb\n?$/);

  // A fresh unit means a fresh history, and reconcile splices carry no history entry at all:
  // undo has nothing to undo, so nothing may change - not the text, and not the save state,
  // because an undo that "did something" here would write into the faction document.
  await ordersInput(page).press("ControlOrMeta+z");
  await expectOrders(page, /^@prepare staf\n@study comb\n?$/);
  await expectOrdersNot(page, /@work/);
});

test("a half-typed command offers its completions", async ({ page }) => {
  await openEditor(page);

  // The vocabulary arrives from the core asynchronously; typing before it lands would get
  // silence and prove nothing about completion.
  await expect(page.locator('[data-commands-ready="true"]')).toBeVisible();

  // The template arrives with orders already on the unit; completion speaks only at the start
  // of a command, so the walk starts from a clean line rather than mid-word in "@study obse".
  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("stu");

  const popup = page.locator(".cm-tooltip-autocomplete");
  await expect(popup).toBeVisible();
  // The *selected* option, not merely a listed one: Enter accepts the selection, and until the
  // popup has made one it falls through to a plain newline - a race an assertion on the list
  // alone walked straight into.
  await expect(popup.locator("li[aria-selected]")).toContainText("STUDY");
  // acceptCompletion deliberately ignores Enter within 75ms of the popup opening (its
  // interactionDelay, there to stop a newline meant for the document accepting a completion).
  // A human never presses inside that window; this test just did.
  await page.waitForTimeout(150);

  await page.keyboard.press("Enter");
  await expectOrders(page, /STUDY/);
  await expect(popup).toHaveCount(0);
});

test("an argument offers the keywords the rules allow there", async ({ page }) => {
  await openEditor(page);

  await expect(page.locator('[data-commands-ready="true"]')).toBeVisible();

  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("NAME U");

  const popup = page.locator(".cm-tooltip-autocomplete");
  await expect(popup).toBeVisible();
  await expect(popup.locator("li[aria-selected]")).toContainText("UNIT");
  // acceptCompletion deliberately ignores Enter within 75ms of the popup opening.
  await page.waitForTimeout(150);

  await page.keyboard.press("Enter");
  // The space `apply` leaves is pinned by the unit test on `apply`; asserting trailing
  // whitespace read back out of CodeMirror's DOM is a flake waiting to happen.
  await expectOrders(page, /NAME UNIT/);
  await expect(popup).toHaveCount(0);
});

test("an item argument offers what the hex sells", async ({ page }) => {
  await openEditor(page);

  await expect(page.locator('[data-commands-ready="true"]')).toBeVisible();

  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("BUY 5 PER");

  const popup = page.locator(".cm-tooltip-autocomplete");
  await expect(popup).toBeVisible();
  // The report reaches the core call here, which no unit test can prove: unit 18642 stands in
  // Inholm, whose "For Sale" line carries 63 perfume [PERF] at $204.
  await expect(popup.locator("li[aria-selected]")).toContainText("PERF");
  // acceptCompletion deliberately ignores Enter within 75ms of the popup opening.
  await page.waitForTimeout(150);

  await page.keyboard.press("Enter");
  await expectOrders(page, /BUY 5 PERF/);
  await expect(popup).toHaveCount(0);
});

test("the caret follows the theme instead of defaulting to black", async ({ page }) => {
  await openEditor(page);

  // The editor uses the browser's native caret, and CodeMirror's base styles paint it black
  // unless told otherwise - invisible on the dark theme's near-black ground. Pinning the caret
  // to the text colour asserts the mechanism whatever the theme in force.
  const colors = await ordersInput(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return { caret: style.caretColor, text: style.color };
  });
  expect(colors.caret).toBe(colors.text);
});

test("a bad order is marked in the editor's own margin", async ({ page }) => {
  await openEditor(page);

  await fillOrders(page, "WROK");

  // The gutter mark and the underline are the editor's part of the story; the list below the
  // editor already has its own coverage and keeps working alongside them.
  await expect(page.getByTestId("orders-input").locator(".cm-lint-marker")).toBeVisible();
  await expect(page.getByTestId("orders-diagnostics")).toContainText("WROK");
});

test("the order text starts within 6px of the editor's edge, marker still showing (gh-205)", async ({
  page
}) => {
  await openEditor(page);

  const input = page.getByTestId("orders-input");
  const gutter = input.locator(".cm-gutter-lint");
  const marker = input.locator(".cm-lint-marker");

  // No-error state first: this is what the player looks at almost all the time, and it is
  // where the permanent margin is actually felt - the earlier version of this test never
  // pinned it at all.
  await fillOrders(page, "@work");
  await expect(marker).toHaveCount(0);

  const containerBoxClean = await input.boundingBox();
  expect(containerBoxClean).not.toBeNull();
  const textStartClean = await textStartX(input.locator(".cm-line").first());
  // Agreed budget from the mockup interview (2026-08-15, docs/ui/orders-editor-left-edge.html):
  // 6px from the container's edge to the first character, plus 0.5px of subpixel slack.
  expect(textStartClean - containerBoxClean!.x).toBeLessThanOrEqual(6.5);

  const gutterBoxClean = await gutter.boundingBox();
  expect(gutterBoxClean).not.toBeNull();
  expect(gutterBoxClean!.width).toBeLessThan(4);

  // Error state: the gutter is reserved space either way, so the budget must hold identically,
  // and the marker - now a 3px full-height bar in the danger token, not the stock dot - must
  // still be visible. A shrink that quietly hid the indicator would fail here.
  await fillOrders(page, "WROK");
  await expect(marker).toBeVisible();
  // `background-color` alone would still read the danger token even if the stock icon crept
  // back (a `content` replaced element paints over its own background) - pin the suppression
  // itself so a future CodeMirror remount cannot bring the hardcoded dot back unnoticed. This
  // browser reports the computed value of an overridden `content: none` as "normal" (its own
  // initial value, not the literal keyword) rather than "url(...)" - which is what CodeMirror's
  // stock rule would compute to if it were still winning the cascade.
  await expect(marker).toHaveCSS("content", "normal");

  const containerBoxError = await input.boundingBox();
  expect(containerBoxError).not.toBeNull();
  const textStartError = await textStartX(input.locator(".cm-line").first());
  expect(textStartError - containerBoxError!.x).toBeLessThanOrEqual(6.5);

  const gutterBoxError = await gutter.boundingBox();
  expect(gutterBoxError).not.toBeNull();
  expect(gutterBoxError!.width).toBeLessThan(4);
});

test("the marker paints in the warning colour for a warning-severity diagnostic (gh-205)", async ({
  page
}) => {
  await openEditor(page);

  // GIVE of an item outside the catalogue is a warning, not an error (it does not block
  // export) - one of the two severities the bar's colour must distinguish.
  await fillOrders(page, "GIVE 45 10 swordz");

  const marker = page.getByTestId("orders-input").locator(".cm-lint-marker");
  await expect(marker).toBeVisible();
  // See the error-state test above for why "normal" is the right expectation here.
  await expect(marker).toHaveCSS("content", "normal");
  const color = await marker.evaluate((element) => getComputedStyle(element).backgroundColor);
  const warnToken = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-warn").trim()
  );
  // An empty token (the variable missing) would make the probe below resolve to the browser's
  // default colour, which could accidentally match `color` and pass for the wrong reason -
  // guard the token is actually defined before trusting the comparison.
  expect(warnToken).not.toBe("");
  // Both read through getComputedStyle so token vs. literal formatting differences (hex vs
  // rgb()) do not cause a false mismatch - compare what the browser resolved both to.
  const warnColor = await page.evaluate((token) => {
    const probe = document.createElement("div");
    probe.style.color = token;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, warnToken);
  expect(color).toBe(warnColor);
});

test("an accepted snippet expands with a tab-through placeholder", async ({ page }) => {
  await openEditor(page);

  // The snippet is created through the same settings pane the player would use.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-tab-snippets").click();
  await page.getByTestId("snippet-name").fill("patrol");
  await page.getByTestId("snippet-body").fill("MOVE ${dir}\nGUARD 1");
  await page.getByTestId("snippet-add").click();
  await expect(page.getByTestId("snippet-row")).toHaveCount(1);
  await page.getByTestId("settings-close").click();

  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("pat");

  const popup = page.locator(".cm-tooltip-autocomplete");
  await expect(popup).toBeVisible();
  await expect(popup.locator("li[aria-selected]")).toContainText("patrol");
  // Past acceptCompletion's 75ms interaction delay, as the completion walk above explains.
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");

  // The ${dir} field arrives as selected placeholder text, so typing replaces it - which is the
  // whole point of a field over a plain insertion.
  await expectOrders(page, /^MOVE dir\nGUARD 1\n?$/);
  await page.keyboard.type("N");
  await expectOrders(page, /^MOVE N\nGUARD 1\n?$/);
});

/** Ticks the Order OCD checkbox in the settings dialog and closes it again. */
async function enableOrderOcd(page: Page) {
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-order-ocd").check();
  await page.getByTestId("settings-close").click();
}

test("with Order OCD on, a keyword uppercases as the word ends and a quoted name is left alone", async ({
  page
}) => {
  await openEditor(page);
  await enableOrderOcd(page);
  await selectUnit(page, OWN_UNIT);

  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type('name unit "seven of eight" ');

  await expectOrders(page, /^NAME UNIT "seven of eight" ?/);

  // Clear of the half-second window history groups typing under, so the next press is a step of
  // its own rather than part of the run above.
  await page.waitForTimeout(700);
  await page.keyboard.type("study");
  await page.waitForTimeout(700);
  await page.keyboard.type(" ");
  await expectOrders(page, /STUDY $/);

  // One press puts back the word as typed and takes the space with it: the uppercasing and the
  // space are a single transaction, which is the whole promise of the setting.
  await ordersInput(page).press("ControlOrMeta+z");
  await expectOrders(page, /study$/);
});

test("with Order OCD off, nothing is uppercased", async ({ page }) => {
  await openEditor(page);

  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type('name unit "seven of eight" ');

  await expectOrders(page, /^name unit "seven of eight" ?/);
});

test("orders written before the setting was on are tidied on the first unit opened after a reload", async ({
  page
}) => {
  await openEditor(page);
  await fillOrders(page, "move n\nstudy combat");
  // The reload proves nothing until the draft has actually been written.
  await expect(page.getByTestId("orders-status")).toContainText(/saved \d/u, { timeout: 20_000 });

  // The setting is turned on for the *next* load only, in the persisted store rather than through
  // the dialog: ticking it here would tidy the mounted editor at once and the reload would then
  // persist an already-upper-case draft, leaving nothing for the vocabulary to arrive late for.
  await page.evaluate(() => {
    const key = "atlantis-hud-settings";
    const stored = JSON.parse(window.localStorage.getItem(key) ?? '{"state":{},"version":0}') as {
      state: Record<string, unknown>;
    };
    stored.state.orderOcd = true;
    window.localStorage.setItem(key, JSON.stringify(stored));
  });

  await page.reload();
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // The first editor mounted since the load: its vocabulary is still in flight when it is built.
  await expectOrders(page, /^MOVE N\nSTUDY COMBAT/);
});

test("turning Order OCD on tidies the unit already on screen", async ({ page }) => {
  await openEditor(page);
  await fillOrders(page, "move n\nstudy combat");
  await enableOrderOcd(page);

  await expectOrders(page, /^MOVE N\nSTUDY COMBAT/);
});

test("with Order OCD on, Enter opens the next line at the block's depth", async ({ page }) => {
  await openEditor(page);
  await enableOrderOcd(page);
  await selectUnit(page, OWN_UNIT);

  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("turn\nform 1\nwork");

  // The keyword shouting and the auto-indent coexist in one run of typing: the newline that ends
  // each keyword both shouts it and opens the next line one level deeper.
  // `work` is still being typed - nothing has ended it - so it is not shouted yet, exactly as this
  // setting has always behaved; `FORM` above it was ended by a space and is.
  await expectOrders(page, /^TURN\n FORM 1\n {2}work/);
});

test("opening a unit with Order OCD on re-indents its whole block", async ({ page }) => {
  await openEditor(page);
  await fillOrders(page, "turn\nform 1\nstudy combat\nend\nendturn");
  await enableOrderOcd(page);

  // Each closer sits with its opener, so the pair brackets the indented run.
  await expectOrders(page, /^TURN\n[ \u00a0]FORM 1\n[ \u00a0]{2}STUDY COMBAT\n[ \u00a0]END\nENDTURN/);
});

test("trailing blank lines survive Enter and collapse when the tidy next runs", async ({ page }) => {
  await openEditor(page);
  await enableOrderOcd(page);
  await selectUnit(page, OWN_UNIT);

  await fillOrders(page, "work");
  await ordersInput(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  // Enter is never absorbed - the player opens as many lines as they press it for.
  await expectOrders(page, /^WORK\n\n\n/);

  // The tidy's clock, not a continuous rule: switching the setting off and on again runs it.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-order-ocd").uncheck();
  await page.getByTestId("settings-order-ocd").check();
  await page.getByTestId("settings-close").click();

  await expectOrders(page, /^WORK\n$/);
});

test("with Order OCD on, one undo takes back a newline and its indent together", async ({ page }) => {
  await openEditor(page);
  await enableOrderOcd(page);
  await selectUnit(page, OWN_UNIT);

  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("turn");
  // The completion popup is open on the half-typed keyword and its own Enter binding outranks the
  // editor's, so accepting a completion is what Enter would do here. Dismiss it first: this walk
  // is about the newline, not about completion.
  await page.keyboard.press("Escape");
  // Clear of the half-second window history groups typing under, as the walk above explains.
  await page.waitForTimeout(700);
  await page.keyboard.press("Enter");
  await expectOrders(page, /^TURN\n[ \u00a0]$/);

  await ordersInput(page).press("ControlOrMeta+z");
  await expectOrders(page, /^turn$/);
});

test("with Order OCD on, Enter dedents the closer the player has just finished", async ({ page }) => {
  await openEditor(page);
  await enableOrderOcd(page);
  await selectUnit(page, OWN_UNIT);

  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("turn\nform 1\nmove n\nend");
  // The completion popup outranks the editor's own Enter; this walk is about the newline.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");

  // `end` was opened at the block's inner depth, because it was inside the block when the line
  // began. Finishing it made it a closer, whose depth is the one outside the block - so the line
  // the player is leaving moves *left*, under its FORM, as well as being shouted.
  await expectOrders(page, /^TURN\n[ \u00a0]FORM 1\n[ \u00a0]{2}MOVE N\n[ \u00a0]END\n[ \u00a0]$/);
});

test("the caret lands on the new line after a dedent, not offset by the spaces removed", async ({
  page
}) => {
  await openEditor(page);
  await enableOrderOcd(page);
  await selectUnit(page, OWN_UNIT);

  // A line after the caret, so an anchor computed on the *old* document overshoots into text
  // instead of being clamped harmlessly at the end of the draft.
  await fillOrders(page, "endturn");
  await ordersInput(page).click();
  // A blank line above it, so the block typed next ends at a line of its own rather than running
  // straight into `endturn` and making one glued word of the two.
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("turn\nform 1\nmove n\nend");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");

  await expectOrders(
    page,
    /^TURN\n[ \u00a0]FORM 1\n[ \u00a0]{2}MOVE N\n[ \u00a0]END\n[ \u00a0]x\nendturn/
  );
});

test("with Order OCD on, ENDTURN at the outermost level stays at the margin", async ({ page }) => {
  await openEditor(page);
  await enableOrderOcd(page);
  await selectUnit(page, OWN_UNIT);

  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("turn\nwork\nendturn");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");

  await expectOrders(page, /^TURN\n[ \u00a0]WORK\nENDTURN\n$/);
});

test("with Order OCD on, one undo hands back the closer exactly as it was typed", async ({
  page
}) => {
  await openEditor(page);
  await enableOrderOcd(page);
  await selectUnit(page, OWN_UNIT);

  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("turn\nform 1\nmove n\nend");
  await page.keyboard.press("Escape");
  // Clear of the half-second window history groups a run of typing under.
  await page.waitForTimeout(700);
  await page.keyboard.press("Enter");
  await expectOrders(page, /[ \u00a0]END\n[ \u00a0]$/);

  // The newline, the shout and the dedent are one transaction, so one press gives back the line
  // lowercase and at the indentation it was typed at.
  await ordersInput(page).press("ControlOrMeta+z");
  await expectOrders(page, /^TURN\n[ \u00a0]FORM 1\n[ \u00a0]{2}MOVE N\n[ \u00a0]{2}end$/);
});

test("with Order OCD on, a stray closer with no opener stays where it is", async ({ page }) => {
  await openEditor(page);
  await enableOrderOcd(page);
  await selectUnit(page, OWN_UNIT);

  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("work\nend");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");

  // A closer that matches nothing changes no depth (`orderIndent`), so the running depth is 0 and
  // the line is already where it belongs.
  await expectOrders(page, /^WORK\nEND\n$/);
});

/**
 * The fixture that carries no orders template at all, and a unit it therefore never listed.
 *
 * Before ah-0gs8 this unit could not be ordered: the editor refused every unit in this report,
 * because the document it was editing was empty. The template is a convenience, not a permission
 * list (`rules/reportformat`), so the block is written on the first keystroke instead.
 */
test("a unit the report's template never listed can still be ordered", async ({ page }) => {
  await loadReport(page, "No template", readReport("g7f62t20"), "regions");

  await selectHex(page, "1:43,81");
  await selectUnit(page, "1656");

  await expect(page.getByTestId("orders-locked")).toHaveCount(0);
  await expect(ordersInput(page)).toBeVisible();

  await fillOrders(page, "buy 1 humn\nstudy forc");

  await expectOrders(page, /study forc/);
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");
});
