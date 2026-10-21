"""Check production HTTP behavior and run existing PWA checks against the image."""

import argparse
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def verify(image, revision):
    container = run("docker", "run", "--detach", "-p", "127.0.0.1:18080:8080", image)
    try:
        for _ in range(45):
            health = run("docker", "inspect", "--format", "{{.State.Health.Status}}", container)
            if health == "healthy":
                break
            if health == "unhealthy":
                raise AssertionError("Production container is unhealthy")
            time.sleep(1)
        else:
            raise AssertionError("Container did not become healthy")

        def fetch(path):
            with urllib.request.urlopen("http://127.0.0.1:18080" + path, timeout=10) as response:
                return response.read(), response.headers

        body, headers = fetch("/")
        assert b"manifest.webmanifest" in body
        assert headers["Cache-Control"] == "no-cache"
        marker, headers = fetch("/release.json")
        assert json.loads(marker)["revision"] == revision
        assert headers["Cache-Control"] == "no-cache"
        for name in ("sw.js", "manifest.webmanifest"):
            _, headers = fetch("/" + name)
            assert headers["Cache-Control"] == "no-cache", f"{name} must revalidate"
        wasm = next((Path("deploy/site/assets")).glob("*.wasm"))
        _, headers = fetch("/assets/" + wasm.name)
        assert headers["Content-Type"] == "application/wasm"
        assert "immutable" in headers["Cache-Control"]
        for path in Path("deploy/site/assets").rglob("*"):
            if path.is_file():
                content, _ = fetch("/assets/" + path.relative_to("deploy/site/assets").as_posix())
                assert content == path.read_bytes(), f"Missing or altered retained asset: {path}"
        for missing in ("/assets/missing.js", "/missing.wasm"):
            try:
                fetch(missing)
            except urllib.error.HTTPError as error:
                assert error.code == 404
            else:
                raise AssertionError(f"Missing asset did not return 404: {missing}")
        subprocess.run(
            ["pnpm", "exec", "playwright", "test", "--config", "deploy/playwright.config.mjs"],
            check=True,
        )
        print("Production container HTTP and PWA checks passed.")
    finally:
        subprocess.run(["docker", "rm", "--force", container], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("image")
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    verify(args.image, args.revision)
