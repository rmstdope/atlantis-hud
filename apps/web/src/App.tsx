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
  // Read once, for the dialog; until it is known the dialog is not drawn, so it never shows the
  // no-games words to a player who has games.
  const [gamesHere, setGamesHere] = useState<GameToSave[] | null>(null);
  useEffect(() => {
    if (!oldAddressOpen) {
      return;
    }
    let current = true;
    void client.listGames().then(
      (games) => {
        if (current) {
          setGamesHere(games.map(({ metadata }) => ({ gameId: metadata.gameId, gameName: metadata.gameName })));
        }
      },
      // A list that cannot be read still owes the player the news and the new address.
      () => {
        if (current) {
          setGamesHere([]);
        }
      }
    );
    return () => {
      current = false;
    };
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
      {oldAddressOpen && gamesHere !== null ? (
        <OldAddressNotice games={gamesHere} saveOne={saveOne} onClose={() => setOldAddressOpen(false)} />
      ) : null}
    </>
  );
}
