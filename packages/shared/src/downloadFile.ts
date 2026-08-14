/**
 * Handing a file to the browser, which is how both shells save most things.
 *
 * An anchor download is all a web page can do, and it is enough for orders and for a game backup:
 * the player asked for the file and the browser puts it where it puts files. Written once because
 * there are three callers, and a fourth that got the object URL revocation wrong would leak the
 * whole file for as long as the session lasts.
 *
 * The map export is the exception, and [`TextFileSaver`] below is why: a file meant to be found
 * again and sent to somebody else needs a path the application can name, and a download reports
 * none. The desktop shell implements that port with a native save dialog (see the desktop app's
 * `saveTextFile.ts`); a browser has nothing to implement it with and falls back to here.
 */
/**
 * A shell that can put a file where the player asks and say where that was.
 *
 * Resolves with the path written, or with null when the player cancelled the save. Only the
 * desktop shell has one; in a browser there is nothing to implement it with, and the download
 * below is what happens instead.
 */
export type TextFileSaver = (fileName: string, text: string) => Promise<string | null>;

/**
 * Saves through the shell's saver when there is one, else the browser download.
 *
 * The fork every exporter needs, pulled out once so a fourth caller cannot get it wrong: a shell
 * that can name a path takes it, and a shell that cannot gets the anchor download instead.
 *
 * Resolves with the path written, `""` for a browser download (which reports none), or `null` when
 * the player cancelled the save - in which case the download is never called.
 *
 * `download` exists for the tests: vitest here runs without a DOM, and `downloadTextFile` touches
 * `document`. It defaults to the real one; callers never pass it.
 */
export async function deliverTextFile(
  saver: TextFileSaver | undefined,
  fileName: string,
  text: string,
  mimeType: string,
  download: typeof downloadTextFile = downloadTextFile
): Promise<string | null> {
  if (saver) {
    const path = await saver(fileName, text);
    return path;
  }
  download(fileName, text, mimeType);
  return "";
}

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
