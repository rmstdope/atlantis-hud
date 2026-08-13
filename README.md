# atlantis-hud

A frontend for Atlantis (PBEM) that can be deployed both as a web and as a desktop application.

## Where your games are kept

Atlantis HUD has no server. Nothing you load or type is ever sent anywhere — your games stay on the
machine you are using. That keeps them private, and it means keeping them safe is partly up to you.

**On the desktop app**, each game is an ordinary file in your user folder, alongside your documents
and photos. It stays there until you delete it, and your usual backups will pick it up.

**In the browser**, games are kept in storage that belongs to that browser on that device. This is
convenient — nothing to install, and your game is there when you come back — but it is not as
durable as a file, and it is worth knowing how it can go away.

### How a browser game can be lost

- **Clearing your browser's site data deletes it.** Clearing your *history* on its own normally
  leaves games alone — it is the "cookies and site data" option, or clearing everything, that
  removes them. In that dialog Atlantis HUD's games look like any other site's data.
- **Safari deletes it after seven days if you do not visit.** This is Safari's normal behaviour for
  websites, and a week between turns is perfectly ordinary in a play-by-email game. **If you use
  Safari, install the app** (Share → Add to Home Screen, or Add to Dock) — installed apps are exempt.
- **A browser short of space may clear it out.** The app now asks your browser to hold on to your
  games, which most will agree to, especially once the app is installed. It is a request, not a
  guarantee.
- **Private or Incognito windows forget everything** the moment you close them.
- **Each browser and each device is separate.** A game started in Chrome on your laptop will not be
  in Safari, or on your phone. There is no syncing between them.

### Keeping a copy

You can now **export one whole game to a single backup file** and **import that file again** on the
same platform or the other one. In a game's menu, open the **This game** tab and use **Export game
backup…** to save a copy. With no game open, the first screen also offers **Import game backup…** so
an empty browser can be restored straight from that file.

The backup includes the game manifest, every imported turn and its raw report text, saved order
drafts, and the remembered map. Importing creates a new game and refuses if that game's id already
exists, so a backup cannot silently overwrite what is already there.

The turn reports are still worth keeping as well: they are the raw source material the game was built
from, and they remain a second line of defence if you ever need one.

### Playing alongside an ally

Load a report belonging to a faction other than the one on screen and the app stops to ask what you
meant by it, because there are two reasonable answers:

- **Merge** — everywhere that faction went is added to your map, and you go on playing your own
  faction with your own orders. Their units show on the shared hexes and cannot be ordered. Only
  offered for a report from the *same turn* as the one you have open, because two reports of one
  turn describe the same moment and neither can be out of date.
- **Switch faction** — the report opens as itself. The map, the units and the orders all become
  that faction's. This is what loading such a report has always done; now it is a choice rather
  than a surprise.

After a merge the header says who is in your map, next to the faction name, and goes on saying it
after a reload. Merging the same ally twice changes nothing.

### Two smaller things

Your orders are saved as you type, a few seconds after you stop, so a crash costs at most the last
sentence or so. And **deleting a game cannot be undone** — the app asks first, and says what will be
lost, because there is no way back.

## Requirements

- Node.js 20+
- pnpm 9+
- Rust stable, with the `wasm32-unknown-unknown` target and `wasm-pack`
- On macOS/Windows, Tauri CLI for the native desktop runtime

Add the wasm target and build tool once:

    rustup target add wasm32-unknown-unknown
    cargo install wasm-pack

No C toolchain beyond your platform's own is required. The shared core is pure Rust, so the
WebAssembly build needs nothing but rustup on macOS, Linux and Windows alike. The desktop build
compiles SQLite through `rusqlite`, which uses the ordinary system compiler that Tauri already
requires.

## Install

```bash
pnpm install
```

Biome textures are committed under `config/public/biomes/`. Regenerate them after changing the
generator with:

```bash
pnpm run generate:biomes
```

## Run the app

### Web app

```bash
pnpm --filter @atlantis/web dev
```

This starts the web shell on the default Vite port.

### Desktop shell preview

```bash
pnpm --filter @atlantis/desktop dev
```

This starts the desktop shell as a Vite app on port `4174`.

### Native desktop runtime

The native desktop app uses Tauri. Its CLI is a workspace dev dependency, so `pnpm install` is all the setup there is:

```bash
pnpm --filter @atlantis/desktop exec tauri dev --features desktop-runtime
```

`tauri dev` reads `apps/desktop/src-tauri/tauri.conf.json`, which starts the desktop Vite dev server automatically through `beforeDevCommand`.

## Check and test

Run the whole repository:

```bash
pnpm run check
```

Run individual checks when you only changed one area:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:smoke
pnpm run build:web && pnpm run test:pwa
```

`test:pwa` runs against a production build and needs one made first — it is the only suite here that
does. It is also the only place the service worker exists at all, which is why it is separate from
the smoke suite rather than a third project in it.

`test:native` drives the real desktop binary over Tauri IPC and is Linux-only: WebKitGTK is the one
webview that speaks WebDriver, so on macOS and Windows this suite runs in CI rather than locally.
On Linux it needs `webkit2gtk-driver` installed, `cargo install tauri-driver --locked`, and a shell
built first:

```bash
pnpm --filter @atlantis/desktop exec vite build
pnpm --filter @atlantis/desktop exec tauri build --debug --no-bundle --features desktop-runtime
xvfb-run pnpm run test:native   # or plain `pnpm run test:native` inside a desktop session
```

Rust-only checks:

```bash
cargo test --workspace
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
```

## Ship it

Full detail, and the reasoning, in `docs/issue-10-release-contracts.md`.

### The web application

Published by hand, from the Actions tab: **Deploy web** → Run workflow, on `main`. It refuses to run
on any other branch. The job builds, runs the PWA suite against the build it is about to upload, and
then uploads it over SFTP to `https://atlantis-hud.kurelid.se` and checks the live site is serving
what it just sent.

It needs three secrets and one variable configured on the repository:

| Name | Kind |
| --- | --- |
| `ONECOM_FTP_SERVER` | secret — the SSH/SFTP hostname |
| `ONECOM_FTP_USERNAME` | secret |
| `ONECOM_FTP_PASSWORD` | secret |
| `ONECOM_FTP_SERVER_DIR` | variable — the directory the domain serves |
| `ONECOM_SFTP_PORT` | variable, optional — defaults to 22 |

The `FTP` in those names is a fossil: the pipeline originally used FTPS, which one.com does not
answer (#43). They hold SFTP credentials.

### The desktop application

Tagging is the release. Bump the version in **both** `package.json` and
`apps/desktop/src-tauri/tauri.conf.json`, then:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

That builds a macOS `.dmg`, a Linux `.AppImage` and a Windows installer, attaches them to a GitHub
Release, **and then publishes the website from the same tag**. The first step of the job checks that
the tag and the two files agree, so a half-done bump fails in seconds rather than after the compile.

There is one macOS download, not two: the bundle is universal, so it runs on Apple Silicon and on
Intel (#56). The job asserts both slices are really in it before publishing anything.

The website step runs only if every desktop bundle built, so a release is all or nothing. When a
desktop build fails but a web fix is waiting, run **Deploy web** by hand — that is what the manual
trigger is for.

To build one locally:

```bash
pnpm --filter @atlantis/desktop exec tauri build --features desktop-runtime
```

That is your own architecture only, which is what you want while developing. What the tag builds is
the universal bundle, and it takes about twice as long:

```bash
pnpm --filter @atlantis/desktop exec tauri build --features desktop-runtime \
  --target universal-apple-darwin
```

**The artifact is not signed by Apple.** That needs a paid Developer Program membership. macOS will
refuse to open the download and say it is damaged; it is not. Clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine "/Applications/Atlantis HUD.app"
```

The release workflow starts signing and notarizing by itself the day the six `APPLE_*` secrets
exist. Nothing else needs changing.

## Rulesets

To fetch the ruleset for a game other than the committed one:

```bash
pnpm --filter @atlantis/ruleset scrape -- \
  --rules https://atlantis-pbem.com/rules \
  --data  https://atlantis-pbem.com/data
```

See `docs/ruleset-contract.md` for what is scraped, what is deliberately not modelled, and why
there is no worker.

## Working on it with agents

Development here is split between a planning session, which turns rough beads into plans and asks
you about anything a player will see, and one or more implementation sessions, which build them
test-first and see them onto main.

See `docs/agent-workflow.md` for how to start each of them, where to find what is waiting on you,
and what the whole thing costs in practice.
