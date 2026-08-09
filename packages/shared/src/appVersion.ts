/**
 * The version of the build that is running.
 *
 * Substituted at build time from the root `package.json`, which is the one place a version is
 * edited. Reading it from a manifest at runtime was the alternative and is worse in both shells:
 * the web build would have to fetch a file to know its own name, and the desktop build would have
 * to ask `@tauri-apps/api`, which this package deliberately does not import.
 *
 * The fallback matters. Vitest applies no `define`, so under the unit tests this constant has no
 * substituted value at all - and a settings panel that throws because nobody wired a build constant
 * is a worse failure than one that says "dev".
 */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
