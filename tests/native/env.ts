import os from "node:os";
import { join } from "node:path";

/**
 * Where the native suite tells the desktop shell to keep its data.
 *
 * A fixed path rather than `mkdtemp`: wdio evaluates this module once in the launcher and again
 * in each worker process, and a random directory would come out different in each. The launcher
 * wipes it in `onPrepare`, which is what gives a local run its isolation; CI is a fresh machine
 * every time.
 *
 * `XDG_DATA_HOME` is set on the tauri-driver process, which the application inherits, so on Linux
 * `app_data_dir()` resolves to `$XDG_DATA_HOME/com.atlantis.hud` and every game the suite creates
 * lands under a directory the Node side of the tests can open directly.
 */
/**
 * Always suffixed, even under the override: the launcher deletes this directory recursively at
 * the start of every run, and an override pointing at, say, `~/.local/share` must never make
 * that wipe reach anything but the suite's own subdirectory.
 */
export const DATA_HOME = join(
  process.env.ATLANTIS_NATIVE_DATA_HOME ?? os.tmpdir(),
  "atlantis-hud-native-e2e"
);

export const APP_DATA_DIR = join(DATA_HOME, "com.atlantis.hud");

export const GAMES_DIR = join(APP_DATA_DIR, "games");
