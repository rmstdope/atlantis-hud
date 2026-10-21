import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

from prepare_site import prepare, previous_releases


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def archive(self, name, files):
        target = self.root / f"{name}.tar.gz"
        with tarfile.open(target, "w:gz") as packed:
            for path, content in files.items():
                data = content.encode()
                entry = tarfile.TarInfo(f"{name}/site/{path}")
                entry.size = len(data)
                packed.addfile(entry, io.BytesIO(data))
        return target

    def site(self):
        return {"index.html": "new", "sw.js": "new-worker", "manifest.webmanifest": "{}",
                "ruleset.json": "{}", "assets/core-new.wasm": "wasm",
                "assets/new-abc123.js": "new-code"}

    def test_preserves_two_prior_asset_sets_not_old_metadata(self):
        current = self.archive("v1.2.3", self.site())
        older = [self.archive(f"v1.2.{number}", {
            "index.html": "old", "sw.js": "old-worker", "release.json": "{}",
            f"assets/old-{number}.js": f"old-code-{number}",
            f"workbox-old{number}.js": f"runtime-{number}",
        }) for number in (1, 2)]
        output = self.root / "output"
        prepare(current, older, output, "a" * 40, "v1.2.3")
        self.assertEqual((output / "index.html").read_text(), "new")
        self.assertEqual((output / "sw.js").read_text(), "new-worker")
        for number in (1, 2):
            self.assertEqual((output / f"assets/old-{number}.js").read_text(), f"old-code-{number}")
            self.assertTrue((output / f"workbox-old{number}.js").is_file())
        self.assertEqual(json.loads((output / "release.json").read_text()),
                         {"revision": "a" * 40, "tag": "v1.2.3"})

    def test_rejects_unsafe_paths_and_missing_pwa_files(self):
        for files in ({"../../outside": "bad"}, self.site() | {"../../../outside": "bad"},
                      {key: value for key, value in self.site().items() if key != "sw.js"}):
            with self.subTest(files=files), self.assertRaises(ValueError):
                prepare(self.archive("bad", files), [], self.root / "output", "a" * 40, "v1.2.3")
            self.assertFalse((self.root / "output").exists())

    def test_conflicting_immutable_asset_cannot_replace_current(self):
        current = self.archive("current", self.site())
        old = self.archive("old", {"assets/new-abc123.js": "different"})
        with self.assertRaisesRegex(ValueError, "collision"):
            prepare(current, [old], self.root / "output", "a" * 40, "v1.2.3")

    def test_selects_two_preceding_stable_versions_not_newer_or_prerelease(self):
        releases = [{"tag_name": tag, "draft": False, "prerelease": False}
                    for tag in ("v1.9.0", "v1.10.0", "v2.0.0", "v1.8.0", "v1.11.0-rc1")]
        releases.append({"tag_name": "v1.11.0", "draft": True, "prerelease": False})
        self.assertEqual([release["tag_name"] for release in previous_releases(releases, "v1.12.0")],
                         ["v1.10.0", "v1.9.0"])
        self.assertEqual(previous_releases(releases, "v0.1.0"), [])


if __name__ == "__main__":
    unittest.main()
