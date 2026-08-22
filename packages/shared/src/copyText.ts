/**
 * Puts `text` on the clipboard. Resolves false when the browser refuses; never throws.
 *
 * The only clipboard write in the application. A refusal is deliberately silent: the panel's text
 * stays selectable, so a failed copy costs the player nothing worth a second notice.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
