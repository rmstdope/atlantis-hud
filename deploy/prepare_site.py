"""Package tested release bytes, retaining two earlier stable asset sets."""

import argparse
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile


TAG = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")


def version(tag):
    match = TAG.fullmatch(tag)
    if match is None:
        raise ValueError(f"Expected a stable vX.Y.Z tag, got {tag!r}")
    return tuple(int(part) for part in match.groups())


def copy_archive(archive, destination, *, previous=False):
    total = 0
    roots = set()
    with tarfile.open(archive, "r:gz") as packed:
        for member in packed:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError(f"Unsafe archive path: {member.name}")
            if len(path.parts) < 3 or path.parts[1] != "site":
                continue
            roots.add(path.parts[0])
            relative = PurePosixPath(*path.parts[2:])
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError(f"Non-regular site file: {member.name}")
            if previous and not (
                relative.parts[0] == "assets"
                or re.fullmatch(r"workbox-[a-zA-Z0-9_-]+\.js", str(relative))
            ):
                continue
            total += member.size
            if member.size > 16 * 1024 * 1024 or total > 128 * 1024 * 1024:
                raise ValueError("Web archive exceeds the static site size limit")
            target = destination.joinpath(*relative.parts)
            content = packed.extractfile(member).read()
            if target.exists():
                if target.read_bytes() != content:
                    raise ValueError(f"Immutable asset content collision: {relative}")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    if len(roots) != 1:
        raise ValueError("Expected exactly one site root in the web archive")


def prepare(archive, previous, output, revision, tag):
    version(tag)
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Source revision must be a full commit SHA")
    if output.exists():
        raise ValueError(f"Output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        site = Path(temporary) / "site"
        site.mkdir()
        copy_archive(archive, site)
        for required in ("index.html", "sw.js", "manifest.webmanifest", "ruleset.json"):
            if not (site / required).is_file():
                raise ValueError(f"Release archive is missing {required}")
        if not list((site / "assets").glob("*.wasm")):
            raise ValueError("Release archive is missing the WebAssembly core")
        for old in previous:
            copy_archive(old, site, previous=True)
        (site / "release.json").write_text(json.dumps({"revision": revision, "tag": tag}) + "\n")
        site.rename(output)


def previous_releases(releases, tag):
    candidates = [release for release in releases
                  if not release["draft"] and not release["prerelease"]
                  and TAG.fullmatch(release["tag_name"])
                  and version(release["tag_name"]) < version(tag)]
    return sorted(candidates, key=lambda release: version(release["tag_name"]), reverse=True)[:2]


def download_previous(repository, tag, directory):
    pages = json.loads(subprocess.check_output(
        ["gh", "api", "--paginate", "--slurp", f"repos/{repository}/releases?per_page=100"],
        timeout=120,
    ))
    archives = []
    for release in previous_releases([item for page in pages for item in page], tag):
        expected = f'atlantis-hud-web-{release["tag_name"]}.tar.gz'
        assets = [asset for asset in release["assets"] if asset["name"] == expected]
        if len(assets) != 1:
            raise ValueError(f"Previous stable release {release['tag_name']} lacks {expected}")
        if assets[0]["size"] > 128 * 1024 * 1024:
            raise ValueError(f"Previous archive is too large: {expected}")
        path = directory / expected
        with path.open("wb") as target:
            subprocess.run(
                ["gh", "api", f"repos/{repository}/releases/assets/{assets[0]['id']}",
                 "-H", "Accept: application/octet-stream"],
                stdout=target, check=True, timeout=120,
            )
        archives.append(path)
        print(f"Retaining immutable assets from {release['tag_name']}")
    return archives


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--previous-output", type=Path,
                        help="Optional most-recent prior site for isolated update verification")
    args = parser.parse_args()
    version(args.tag)
    with tempfile.TemporaryDirectory() as temporary:
        previous = download_previous(args.repository, args.tag, Path(temporary))
        prepare(args.archive, previous, args.output, args.revision, args.tag)
        if args.previous_output and previous:
            old_tag = previous[0].name.removeprefix("atlantis-hud-web-").removesuffix(".tar.gz")
            prepare(previous[0], [], args.previous_output, "0" * 40, old_tag)


if __name__ == "__main__":
    main()
