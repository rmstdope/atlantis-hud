/**
 * Putting a string on the clipboard, wherever there is one.
 *
 * The Clipboard API is absent over plain http, in some webviews, and wherever the browser has
 * refused permission - so the call has to be treated as something that may not be there at all,
 * rather than as something that may reject. Optional chaining alone is the trap: the expression
 * evaluates to `undefined` and the `.then` after it throws out of the click handler, turning a
 * button that could do nothing into one that breaks the dialog around it.
 *
 * Answers whether the text was copied, so the caller can say so - or say nothing, which is the
 * right amount to say about a copy that did not happen while the text is on screen to be selected.
 */
export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard
): Promise<boolean> {
  if (typeof clipboard?.writeText !== "function") {
    return false;
  }

  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
