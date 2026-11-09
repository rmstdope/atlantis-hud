import { expect, test, type Page } from "@playwright/test";
import { loadReport } from "./gameSetup";

/**
 * The sea steps eight times a second, at one hex width every eighteen seconds (ah-5l9jg).
 *
 * The timer lives in an effect, which `packages/shared` cannot run, so this walk is its only proof.
 * The bounds are about what a browser can do, not what a loaded CI runner does: the ceiling is the
 * point (a per-frame drift would show far more than 18 changes in two seconds), the floor only has
 * to tell a running timer from a stopped one.
 */

const SAMPLE_MS = 2000;

interface Sample {
  changes: number;
  elapsedMs: number;
  first: number;
  last: number;
}

function driftOf(page: Page, sampleMs: number): Promise<Sample | null> {
  return page.evaluate(
    (duration) =>
      new Promise<Sample | null>((resolve) => {
        const group = document.querySelector("[data-water-loop]");
        if (!group) {
          resolve(null);
          return;
        }
        const position = () => Number(/translate\(([-\d.e]+)/u.exec(group.getAttribute("transform") ?? "")?.[1] ?? 0);
        const start = performance.now();
        const first = position();
        let previous = first;
        let changes = 0;
        const frame = () => {
          const now = position();
          if (now !== previous) {
            changes += 1;
            previous = now;
          }
          if (performance.now() - start < duration) {
            requestAnimationFrame(frame);
          } else {
            resolve({ changes, elapsedMs: performance.now() - start, first, last: now });
          }
        };
        requestAnimationFrame(frame);
      }),
    sampleMs
  );
}

test("the sea steps at the agreed rate and speed on a small map at the default setting", async ({ page }) => {
  await loadReport(page);
  // The first redraw, not just the mounted group: until then the position reads as nothing.
  await expect(page.locator("[data-water-loop]").first()).toHaveAttribute("transform", /translate/u);

  const sample = await driftOf(page, SAMPLE_MS);

  expect(sample).not.toBeNull();
  const { changes, elapsedMs, first, last } = sample as Sample;
  expect(changes).toBeGreaterThanOrEqual(8);
  expect(changes).toBeLessThanOrEqual(18);
  // Wrapped to the loop: the sample may cross the point where the picture starts over.
  const widthsPerSecond = (((last - first + 1) % 1) / elapsedMs) * 1000;
  expect(widthsPerSecond).toBeGreaterThan((1 / 18) * 0.7);
  expect(widthsPerSecond).toBeLessThan((1 / 18) * 1.3);
});
