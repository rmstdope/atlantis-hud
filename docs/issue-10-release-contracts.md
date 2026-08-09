# Deployment and release (issue #10)

The web application is installable, works with the network cut, and can be published to
`atlantis-hud.kurelid.se`. The desktop application can be built into a `.dmg` and attached to a
GitHub Release. Both shells show the version they are running and offer a way to look for a newer
one.

Until this issue, nothing in the repository published anything. There was one workflow, it ended at
`cargo clippy`, and `tauri.conf.json` had `"bundle": { "active": false }` — no `.app` had ever been
produced. Nothing ran `vite build` either, so a production build that failed outright would have
reached `main` unnoticed.

## Three decisions that differ from the original plan

### Hosting is one.com, not GitHub Pages

`docs/implementation-plan.md` said Pages. This repository is private, and Pages from a private
repository requires a paid plan **and** publishes a site that is public regardless — it would have
cost money to get less. The site is served from the root of a domain we own, which also removes a
problem Pages would have introduced: a project site lives at `/atlantis-hud/`, and the shells fetch
`/ruleset.json` by absolute path.

Because the site is at a domain root, and because Tauri serves from `tauri://localhost/`, Vite's
default `base: "/"` is correct in both builds and `packages/shared/src/rulesets.ts` needs no change.

### Deployment is manual

`workflow_dispatch`, refusing to run on any ref but `main`. There is one environment and it is the
live one; a push publishing straight to it leaves no moment at which somebody decides that *this*
build is the one people see.

The guard is a failing first step rather than a job-level `if:`. A skipped job reports as success,
and a deploy that quietly did not happen is exactly what the guard exists to prevent.

The workflow builds, runs the PWA suite **against the bytes it is about to upload**, and only then
uploads. CI has already tested the commit, but CI tested a build it made itself. Afterwards it
fetches the live site and checks that what came back is this build — an upload can succeed into a
directory the web server does not serve, and that is the mistake `ONECOM_FTP_SERVER_DIR` invites.

### Uploading is SFTP, not FTPS (issue #43)

The first version of this pipeline used `SamKirkland/FTP-Deploy-Action` over FTPS, on the assumption
that one.com offers FTPS on every plan. It does not answer FTPS at all — it aborts the TLS handshake
with `tlsv1 alert internal error` — and the assumption had never been tested, because no credentials
existed when the pipeline was written.

SFTP runs over SSH, so this was not a flag on the same action: `FTP-Deploy-Action` speaks `ftp`,
`ftps` and `ftps-legacy` only and cannot reach this host by any configuration.

The replacement is `lftp`, chosen over the various SFTP actions because it authenticates with a
password without needing an SSH key on the account, and because `mirror` is a recursive upload with
retries rather than a loop over `put`. The password arrives through `LFTP_PASSWORD` and
`--env-password` rather than on the command line, where it would be readable by anything that can
list processes on the runner.

Two settings are deliberate:

- `set cmd:fail-exit yes` stops at the first failing command instead of carrying on to `bye` and
  exiting on *its* status. A refused connection fails the job either way — measured — but a partial
  failure part-way through would otherwise report success.
- **No `--delete`.** Vite names assets by content hash, so an old file is never overwritten by a
  different one; it simply stops being referenced. Deleting them breaks exactly the client this is
  most careful about — a browser holding a cached service worker still asking for the previous
  build's chunk names. They cost kilobytes.

### The macOS artifact is unsigned

Signing and notarizing require a paid Apple Developer Program membership, and there is no free path
to a notarized build. Tauri ad-hoc signs instead, which is enough to run and not enough to satisfy
Gatekeeper: the download arrives quarantined and macOS calls it damaged. It is not. Once, per
install:

```
xattr -dr com.apple.quarantine "/Applications/Atlantis HUD.app"
```

`release.yml` is written so this reverses without a rewrite. It exports the six `APPLE_*` variables
into the environment **only when `APPLE_CERTIFICATE` is non-empty**, because an unset GitHub secret
interpolates to an empty string and an empty string is still a set environment variable — which
Tauri reads as "sign", and then fails importing a certificate that is not there.

## What publishes what

| Trigger | Workflow | Produces |
| --- | --- | --- |
| Every push and pull request | `ci.yml` | Nothing. Gates only, now including a production build. |
| `workflow_dispatch` on `main` | `deploy.yml` | The web application at `https://atlantis-hud.kurelid.se` |
| A `v*` tag | `release.yml` | A GitHub Release with an Apple Silicon `.dmg` attached |

### Configuration this needs

| Name | Kind | What it is |
| --- | --- | --- |
| `ONECOM_FTP_SERVER` | secret | one.com SSH/SFTP hostname |
| `ONECOM_FTP_USERNAME` | secret | SFTP user for the subdomain's webspace |
| `ONECOM_FTP_PASSWORD` | secret | that user's password |
| `ONECOM_FTP_SERVER_DIR` | variable | remote directory the domain serves, e.g. `/webroots/36700328/` |
| `ONECOM_SFTP_PORT` | variable | optional; defaults to 22 |

The `FTP` in those three names is a fossil of the original FTPS design. They were already configured
when the protocol changed and renaming them would have meant re-entering credentials to no effect,
so they kept their names. They hold SFTP credentials.
| `APPLE_*` (six) | secrets | Absent. Signing stays off until they exist. |

`deploy.yml` checks all four before it builds, rather than discovering a missing one at the upload
step ten minutes later.

The site must be served over **HTTPS**. A service worker will not register otherwise, and without
one there is no installability and no offline.

## Versions

The root `package.json` is the single source. Vite substitutes it into both bundles as
`__APP_VERSION__`, read through `packages/shared/src/appVersion.ts`, which falls back to `"dev"`
because Vitest applies no `define` and a settings panel that throws is worse than one that says
`dev`.

Two things keep the copies honest:

- `packages/shared/src/appVersion.test.ts` asserts `package.json` and `tauri.conf.json` agree. This
  runs on every pull request.
- `release.yml` asserts the tag agrees with both, as its first step, before compiling anything.

Bumping a version therefore means editing two files and tagging `v<version>`.

## The update check

The two shells answer "is there a newer version" differently, and the difference is real rather than
incidental. `packages/shared/src/workspace/appUpdate.ts` is the one contract both satisfy; each
shell injects its own implementation, the same pattern `registerBeforeQuit` uses to keep
`@tauri-apps/api` out of a package whose job is to be identical on both platforms.

**Web.** A service worker with `registerType: "prompt"`. A new deployment is discovered by the
running page and waits: it says "A new version is ready" and offers a reload. It does not swap the
code underneath somebody mid-sentence — this application holds unsaved order drafts, and the few
seconds that would save are not worth it.

**Desktop.** The button opens the releases page in the player's own browser, and that is all it
does. It cannot compare versions: this repository is private, so its releases are invisible to an
unauthenticated request. The alternatives were to ship a GitHub token inside the application or to
publish a version manifest somewhere public, and neither is worth it for a check that ends in a
browser download anyway. The browser is also where the GitHub session already is.

**Neither.** The desktop bundle opened in a plain browser — `pnpm --filter @atlantis/desktop dev`,
and the Playwright `desktop-shell` project — has no Tauri runtime and no service worker. That is a
declared state, `unsupported`, which renders as no button rather than a button that does nothing.

## The ACL blind spot

`opener:allow-open-url` is granted in `apps/desktop/src-tauri/capabilities/default.json`, scoped to
`https://github.com/rmstdope/atlantis-hud/*` rather than granted outright — the update check needs
exactly one address, and a webview that can ask the operating system to open anything is a larger
thing to own than that.

`docs/issue-34-persistence-contracts.md` records the problem with that file: `build.rs` only runs
`tauri_build` under the Tauri CLI, so neither `cargo check` nor CI ever reads it. A missing
permission fails at runtime, in a release build, on somebody's machine.

`apps/desktop/src/updateCheck.test.ts` is a partial guard. It cannot prove the ACL is correct — only
the Tauri CLI can, and it does, on the tag. What it catches is the mistake that actually happens:
adding a plugin and forgetting its permission, or moving the URL and leaving the scope behind.

## Testing a production build

`playwright.pwa.config.ts` is a second Playwright configuration rather than a third project in the
first one, for a mechanical reason: Playwright starts every `webServer` a config declares, whichever
project is run. A `vite preview` entry in `playwright.config.ts` would make the two existing smoke
jobs depend on a build artifact that is not there, and fail them for it.

`tests/pwa/install.spec.ts` covers the manifest, service worker registration, and a reload with the
network cut. One thing in it is worth knowing before editing it: it waits on
`navigator.serviceWorker.ready`, not on a poll of `registration.active.state === "activated"`. The
poll was measured to resolve *before* Chromium will route a navigation through the worker, so a
reload issued on it comes off the network and leaves the page permanently uncontrolled — the test
failed deterministically that way, and the failure looked like a broken service worker rather than a
broken test.

## Icons

`config/public/icons/` is derived from `apps/desktop/src-tauri/icons/icon.png` with macOS's built-in
`sips`, so the web and desktop builds carry the same mark and nothing new was added to the toolchain.
The maskable variant is padded to 640 on the theme's ground colour and resized back to 512, so
Android's circular crop takes the padding rather than the artwork.

That mark is still Tauri's placeholder — a plain blue square. Replacing it is worth doing and is not
part of this issue; when it happens, both builds change together because both read the same source.

## Not done here

Windows and Linux bundles. The Tauri dependencies in `apps/desktop/src-tauri/Cargo.toml` are
`cfg`-gated to macOS and Windows, so Linux would need crate changes as well as a workflow.

In-app auto-update via `tauri-plugin-updater`. It needs a public endpoint, and self-replacing an
un-notarized `.app` is fragile. "Manual update check" is what the issue asks for and what this does.
