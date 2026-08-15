/**
 * A shell's way of putting a file where the player asks. Required of every shell (ah-150): the fork
 * between "dialog" and "download" used to be an optional prop each exporter had to remember to take,
 * and the same defect - a desktop export landing wherever the webview put it, no dialog, no path -
 * was fixed three times before the fork was made a required port instead.
 *
 * Resolves with the path written, `""` when the shell cannot name one (a browser download), or
 * `null` when the player cancelled the save.
 */
export type TextFileSaver = (fileName: string, text: string, mimeType: string) => Promise<string | null>;

/**
 * The browser's implementation: an anchor download, which reports no path.
 *
 * An anchor download is all a web page can do, and it is enough for orders and for a game backup:
 * the player asked for the file and the browser puts it where it puts files. The desktop shell
 * implements the same port with a native save dialog instead (see the desktop app's
 * `saveTextFile.ts`).
 */
export const browserTextFileSaver: TextFileSaver = async (fileName, text, mimeType) => {
  downloadTextFile(fileName, text, mimeType);
  return "";
};

function downloadTextFile(fileName: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // After the click, and on a later task: revoking synchronously cancels the download in some
  // browsers, which is why this is not simply the next statement.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
