#!/usr/bin/env python3
"""Exercise release-ref integrity checks in a disposable Git repository."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("clockoli_release_build", ROOT / "scripts/build-release.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix="clockoli-release-ref-") as directory:
    checkout = Path(directory)

    def git(*args):
        return subprocess.run(["git", *args], cwd=checkout, check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True).stdout.strip()

    def must_reject(ref, expected):
        try:
            module.require_release_ref(ref, checkout)
        except ValueError as exc:
            assert expected in str(exc), str(exc)
        else:
            raise AssertionError("Release-ref validation unexpectedly passed")

    git("init", "-q")
    git("config", "user.name", "Clockoli CI")
    git("config", "user.email", "ci@example.invalid")
    git("config", "commit.gpgsign", "false")
    tracked = checkout / "tracked.txt"
    tracked.write_text("original\n")
    git("add", "tracked.txt")
    git("commit", "-q", "-m", "Initial source")
    git("tag", "0.3.0")
    module.require_release_ref("0.3.0", checkout)

    tracked.write_text("modified\n")
    must_reject("0.3.0", "clean Git working tree")
    git("checkout", "--", "tracked.txt")

    untracked = checkout / "untracked.txt"
    untracked.write_text("not committed\n")
    must_reject("0.3.0", "clean Git working tree")
    untracked.unlink()

    git("commit", "-q", "--allow-empty", "-m", "Another commit")
    must_reject("0.3.0", "does not match checked-out HEAD")
    module.require_release_ref("HEAD", checkout)

print("Release-ref checkout integrity tests passed")
