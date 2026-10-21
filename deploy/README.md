# Additional manual deployment on rmstdope.eu

The existing desktop release and automatic SFTP deployment to
`https://atlantis-hud.kurelid.se` remain unchanged. This adds a separate,
**manually deployed** target at `https://atlantis-hud.rmstdope.eu`.

## Release and deploy

Continue cutting releases with the existing command:

```sh
pnpm run release maintenance
```

The tag workflow builds and PWA-tests the web tarball as before. The new
`web-image` job consumes those exact bytes without rebuilding Rust, WASM or the
frontend. It builds and checks a linux/amd64 Caddy image, then publishes
`ghcr.io/rmstdope/atlantis-hud-web:vX.Y.Z`. Keep this GHCR package private and
grant the deployment host a separate package-read credential.

After the desktop/web GitHub release publishes and the image checks succeed,
`publish-deployment` attaches `deployment.json` to the release. It contains the
tag, full source commit and immutable image digest. This does not wait for or
depend on one.com's upload, and a new-container failure does not block the
existing `publish` or `web` jobs.

From a configured operator machine, with the updated `rmstdope-infra` checkout:

```sh
rmstdope-deploy release atlantis-hud --latest
# Or select a specific stable release:
rmstdope-deploy release atlantis-hud --tag v0.30.0
rmstdope-deploy status atlantis-hud
rmstdope-deploy rollback atlantis-hud
```

The first deployable tag must include this workflow change; older release pages
do not contain `deployment.json`. The CLI fails explicitly for such releases.
`--latest` uses GitHub's latest stable release designation, not main HEAD or a
mutable image tag. Confirm the displayed tag/revision/digest before deployment.
There are no VPS SSH secrets in Actions and no automated production deployment.

## PWA behavior

Each container contains the current release and immutable `assets/` and hashed
Workbox runtime files from the **two preceding stable semantic versions**.
Earlier archives are fetched from their existing GitHub release assets, excluding
drafts, prereleases and newer versions. Old HTML, ruleset and worker entry points
are never copied over current metadata. Missing prior archives fail packaging
explicitly rather than silently dropping compatibility.

This bounds asset growth. An open client older than that window may need to
reload. Rollback may also require a reload for a client running newer code: it
does not undo local browser data/schema changes. Export important games before
upgrading or downgrading between incompatible app versions.

HTML, `sw.js`, `registerSW.js`, `manifest.webmanifest`, and `release.json` are
served with `no-cache`; hashed assets are immutable. Caddy serves `.wasm` as
`application/wasm`. Missing files return 404, not the SPA shell.

The two hostnames have **separate browser storage and PWA installations**. Nothing
syncs between them. Use the existing game backup export/import to move data, and
do not delete the original site's data until the new copy has been checked.

## Validation

```sh
python3 -m unittest discover -s deploy -p 'test_prepare_site.py' -v
```

CI hands its real PWA-tested production output to the new container check job.
It builds the container, verifies HTTP/cache/WASM/retained assets, runs the
existing PWA install/offline tests against Caddy, and tests an installed previous
release discovering the update while retaining offline startup and origin data.
The previous-release transition is skipped explicitly only when no earlier stable
release exists. No production server is used for checks.

`deploy/site` is generated and ignored. Docker context is restricted to that site
and its runtime configuration; application source and secrets are not copied.
