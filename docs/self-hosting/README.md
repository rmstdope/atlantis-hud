# Self-hosting the Atlantis HUD web client

This tarball contains the complete, built Atlantis HUD web application: everything under
`site/` is the output of a production build, ready to be served as-is. There is **no server
side** — no database, no API, nothing to run besides a plain HTTP(S) file server. Hosting it is
unpacking this tarball and pointing a web server at `site/`.

## Where to put it

Serve the **contents** of `site/` from the **root** of a domain or subdomain —
`https://hud.example.com/`, never `https://example.com/hud/` or any other subdirectory.

This is a hard requirement, not a recommendation. The build pins the Progressive Web App
manifest's `start_url` and `scope`, and the service worker's registration scope, to `/`. Serve it
from anywhere else and the install prompt, the offline cache and page navigation all silently
break in different ways. Subdirectory hosting is not supported by this build; if you need it, a
different build is required (ask on the project's issue tracker rather than trying to make this
one work).

## Requirements

**HTTPS.** The service worker — which is what makes the app installable and lets it keep working
offline — refuses to register outside a "secure context". Browsers treat `http://localhost` as an
exception for local testing, but any other plain-HTTP origin will load the app while quietly
never registering the worker, no offline support and no install prompt. There is no error dialog
for this; it just does not happen.

**The `application/wasm` MIME type**, for the file under `site/assets/` whose name starts with
`atlantis_core_bg` and ends `.wasm`. This is the WebAssembly module the whole application is
built around — it decodes and displays Atlantis turn reports. If your server does not know the
`.wasm` extension (some ship with a `mime.types` file that predates it), the browser will refuse
to instantiate the module: the page loads, the shell renders, but no report can be opened. The
two samples in `server-samples/` set this explicitly so you do not need to track it down from
that symptom.

## Caching

Everything under `site/assets/` is named with a content hash (Vite's doing) and is safe to cache
forever — a new build never reuses an old file's name, so a stale cached copy is simply never
requested again.

`index.html`, `sw.js`, `registerSW.js` and `manifest.webmanifest` are the opposite: they are the
entry points a returning visitor's browser checks to discover a new build, so they must be sent
with `no-cache` (always revalidated). Cache them and a deployed update will never reach anyone
who has already visited — the browser will keep serving the old shell indefinitely.

Both `server-samples/nginx.conf` and `server-samples/apache.conf` set this split up already; treat
them as the source of truth rather than re-deriving the header list.

## Single-page routing

There is one HTML document and no server-side router: any path the browser requests that is not a
real file under `site/` should fall back to `site/index.html`, so the app's own client-side
routing can take over. Both samples include this fallback.

## Version and updates

The name of the unpacked top-level directory carries the version this tarball was built from
(`atlantis-hud-web-v<version>`). Releases, including future tarballs, are published at
`https://github.com/rmstdope/atlantis-hud/releases`. To upgrade, download the new tarball and
replace the contents of `site/` — the immutable/no-cache split above is what makes that safe to do
without also clearing every visitor's cache by hand.
