#!/usr/bin/env python3
"""Run Safari license-content checks against a synthetic native macOS bundle."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("clockoli_safari_build", ROOT / "scripts/build-safari.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
legal = json.loads((ROOT / "scripts/legal-files.json").read_text())

with tempfile.TemporaryDirectory(prefix="safari-legal-fixture-") as directory:
    app = Path(directory) / "Clockoli.app"
    resources = app / "Contents/PlugIns/Clockoli Extension.appex/Contents/Resources/extension"
    host_resources = app / "Contents/Resources"
    for name in legal:
        target = resources / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
        host_target = host_resources / name
        host_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, host_target)
    module.verify_app_licenses(app)
    target = resources / legal[-1]
    target.write_text("Not the expected license contents\n")
    try:
        module.verify_app_licenses(app)
    except ValueError as exc:
        assert "stale or modified license" in str(exc)
    else:
        raise AssertionError("Tampered Safari license should fail validation")
    target.unlink()
    try:
        module.verify_app_licenses(app)
    except ValueError as exc:
        assert "missing bundled license" in str(exc)
    else:
        raise AssertionError("Missing Safari license should fail validation")
    # The host app still has all legal files. That must not be enough.
    shutil.rmtree(resources)
    try:
        module.verify_app_licenses(app)
    except ValueError as exc:
        assert "missing bundled license" in str(exc)
    else:
        raise AssertionError("Host-only licenses should fail extension validation")

print("Safari native bundle license fixture checks passed")
