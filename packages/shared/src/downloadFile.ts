/**
 * Saving a file, the one way both shells do it.
 *
 * The desktop shell has no filesystem plugin and needs none: it renders the same web application,
 * so an anchor download opens the system save dialog there and the browser's downloads folder
 * here. Written once because there are now three callers, and a fourth that got the object URL
 * revocation wrong would leak the whole file for as long as the session lasts.
 */
/**
 * A shell that can put a file where the player asks and say where that was.
 *
 * Resolves with the path written, or with null when the player cancelled the save. Only the
 * desktop shell has one; in a browser there is nothing to implement it with, and the download
 * below is what happens instead.
 */
export type TextFileSaver = (fileName: string, text: string) => Promise<string | null>;

export function downloadTextFile(fileName: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // After the click, and on a later task: revoking synchronously cancels the download in some
  // browsers, which is why this is not simply the next statement.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
