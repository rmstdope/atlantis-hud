import type { CoreClient, StorageStopSource } from "@atlantis/core-client";
import type { GameToSave } from "@atlantis/shared";
import {
  AppShell,
  browserHttpTransport,
  browserTextFileSaver,
  deliverGameBackupExport,
  isOldAddress,
  OldAddressNotice
} from "@atlantis/shared";
import { useEffect, useState } from "react";
import { useWebAppUpdate } from "./useWebAppUpdate";

/**
 * The web shell.
 *
 * Everything visible lives in AppShell, shared with the other platform, so the two builds are
 * identical rather than merely similar. All that differs is the core this hands it - WebAssembly
 * here, Tauri IPC on the native desktop - the one thing only a served application has: a copy
 * on a server that can be newer than the copy that is running - and the browser's own `fetch` as
 * the way to reach a New Age world.
 *
 * And one thing only an address has: the old one is closing down (ah-gup7g). Asked here, in the
 * web shell alone, so the desktop app can never open the dialog that says so.
 */
export default function App({
  client,
  storageStop
}: {
  client: CoreClient;
  storageStop: StorageStopSource;
}) {
  const [oldAddressOpen, setOldAddressOpen] = useState(() => isOldAddress(window.location.hostname));
  const listGames = async (): Promise<GameToSave[]> =>
    (await client.listGames()).map(({ metadata }) => ({
      gameId: metadata.gameId,
      gameName: metadata.gameName
    }));
  // Read once, for the dialog's words; until it is known the dialog is not drawn, so it never shows
  // the no-games words to a player who has games. A list that cannot be read (another tab holding
  // it) counts as having games: the steps stay, and the button reads the list again when pressed.
  const [hasGamesHere, setHasGamesHere] = useState<boolean | null>(null);
  useEffect(() => {
    if (!oldAddressOpen) {
      return;
    }
    let current = true;
    void listGames().then(
      (games) => {
        if (current) {
          setHasGamesHere(games.length > 0);
        }
      },
      () => {
        if (current) {
          setHasGamesHere(true);
        }
      }
    );
    return () => {
      current = false;
    };
    // `listGames` is rebuilt every render from `client`, which is what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, oldAddressOpen]);

  const saveOne = async ({ gameId, gameName }: GameToSave) =>
    deliverGameBackupExport(
      browserTextFileSaver,
      gameName,
      await client.exportGame(gameId, new Date().toISOString())
    );

  return (
    <>
      {/* Inert while the dialog is up, so nothing behind it takes a click or the focus. */}
      <div className="contents" inert={oldAddressOpen}>
        <AppShell
          client={client}
          storageStop={storageStop}
          platformLabel="web"
          appUpdate={useWebAppUpdate()}
          saveTextFile={browserTextFileSaver}
          // A New Age world allows cross-origin requests from the live web address, so the browser's
          // own fetch reaches it. Offered on every address: a self-hosted copy the world refuses gets
          // the sign-in sentence that names that cause.
          newAgeTransport={browserHttpTransport}
          newAgeFromBrowser
        />
      </div>
      {oldAddressOpen && hasGamesHere !== null ? (
        <OldAddressNotice
          hasGames={hasGamesHere}
          listGames={listGames}
          saveOne={saveOne}
          onClose={() => setOldAddressOpen(false)}
        />
      ) : null}
    </>
  );
}
