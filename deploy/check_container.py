"""Build and check the production image from an existing PWA-enabled web build."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile


def run(*args):
    subprocess.run(args, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--tag")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as temporary:
        stage = Path(temporary)
        archive = args.archive or stage / "current.tar.gz"
        if args.archive is None:
            with tarfile.open(archive, "w:gz") as packed:
                packed.add("apps/web/dist", arcname="current/site")
        tag = args.tag or "v" + json.loads(Path("package.json").read_text())["version"]
        run("python3", "-m", "unittest", "discover", "-s", "deploy", "-p", "test_prepare_site.py", "-v")
        run("python3", "deploy/prepare_site.py", "--archive", str(archive),
            "--output", "deploy/site", "--previous-output", str(stage / "previous-site"),
            "--revision", os.environ["GITHUB_SHA"], "--tag", tag,
            "--repository", os.environ["GITHUB_REPOSITORY"])
        run("docker", "build", "--tag", "atlantis-hud:smoke", "deploy")
        run("python3", "deploy/test_container.py", "atlantis-hud:smoke",
            "--revision", os.environ["GITHUB_SHA"])
        if (stage / "previous-site").exists():
            previous = stage / "previous"
            previous.mkdir()
            for name in ("Dockerfile", "Caddyfile", ".dockerignore"):
                shutil.copyfile(Path("deploy") / name, previous / name)
            (stage / "previous-site").rename(previous / "site")
            run("docker", "build", "--tag", "atlantis-hud:previous-smoke", str(previous))
            run("pnpm", "exec", "node", "deploy/test_update.mjs")
        else:
            print("No preceding stable release exists; old-to-new PWA check is not applicable.")


if __name__ == "__main__":
    main()
