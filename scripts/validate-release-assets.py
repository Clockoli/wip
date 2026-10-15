#!/usr/bin/env python3
"""Validate collected release assets and render version-specific changelog notes.

Used by both read-only release previews and actual GitHub Releases.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
LEGAL = json.loads((ROOT / "scripts/legal-files.json").read_text())


def check_zip(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError(f"Duplicate ZIP paths: {path.name}")
        corrupt = archive.testzip()
        if corrupt:
            raise ValueError(f"Corrupt ZIP member in {path.name}: {corrupt}")
        return set(names)


def check_browser(path, version):
    names = check_zip(path)
    for name in ("manifest.json", *LEGAL):
        if name not in names:
            raise ValueError(f"{path.name} missing required file: {name}")
    with zipfile.ZipFile(path) as archive:
        if json.loads(archive.read("manifest.json"))["version"] != version:
            raise ValueError(f"{path.name} manifest version mismatch")
        for name in LEGAL:
            if archive.read(name) != (ROOT / name).read_bytes():
                raise ValueError(f"{path.name} legal contents differ: {name}")


def release_notes(version):
    lines = (ROOT / "CHANGELOG.md").read_text().splitlines()
    heading = re.compile(r"^## \[([^\]]+)\]")
    found = False
    selected = []
    for line in lines:
        match = heading.match(line)
        if match:
            if found:
                break
            found = match.group(1) == version
            continue
        if found:
            selected.append(line)
    notes = "\n".join(selected).strip()
    if not notes:
        raise ValueError(f"No non-empty CHANGELOG.md section for {version}")
    return notes + "\n"


def verify(directory, version, notes_path):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", version):
        raise ValueError(f"Invalid release version: {version}")
    required = {
        f"Clockoli-{version}.zip",
        f"Clockoli-{version}-firefox.xpi",
        f"Clockoli-{version}-safari-extension.zip",
        f"Clockoli-{version}-source.zip",
        f"Clockoli-{version}-safari-unsigned.zip",
    }
    optional = {
        f"Clockoli-{version}-firefox-signed.xpi",
        f"Clockoli-{version}-safari.zip",
        f"Clockoli-{version}-safari.pkg",
    }
    provided = {item.name for item in directory.iterdir() if item.is_file()}
    missing = required - provided
    unexpected = provided - required - optional
    if missing or unexpected:
        raise ValueError(f"Invalid assets: missing={sorted(missing)}, unexpected={sorted(unexpected)}")
    for name in (f"Clockoli-{version}.zip", f"Clockoli-{version}-firefox.xpi",
                 f"Clockoli-{version}-safari-extension.zip"):
        check_browser(directory / name, version)
    for name in sorted(provided):
        item = directory / name
        if not item.stat().st_size:
            raise ValueError(f"Empty release asset: {name}")
        if name.endswith((".zip", ".xpi")):
            entries = check_zip(item)
            if name.endswith("-source.zip"):
                for source in ("LICENSE", "COPYRIGHT", "scripts/package-source.py",
                               "src/vendor/html2pdf.bundle.min.js",
                               "third_party/html2pdf.js-v0.14.0/src/index.js"):
                    if source not in entries:
                        raise ValueError(f"{name} missing Corresponding Source: {source}")
            if name.endswith("-safari-unsigned.zip") or name.endswith("-safari.zip"):
                if not any(part.startswith("Clockoli.app/Contents/PlugIns/") and ".appex/" in part
                           for part in entries):
                    raise ValueError(f"{name} missing Safari extension")
        digest = hashlib.sha256(item.read_bytes()).hexdigest()
        print(f"{name}: {item.stat().st_size} bytes; SHA256={digest}")
    notes_path.parent.mkdir(parents=True, exist_ok=True)
    notes_path.write_text(release_notes(version))
    print(f"Validated {len(provided)} release assets and changelog for {version}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifacts", type=Path, help="Directory downloaded from release-zip")
    parser.add_argument("version", help="Version from manifest.json or release tag")
    parser.add_argument("notes_output", type=Path, help="Version-specific release notes output")
    args = parser.parse_args()
    verify(args.artifacts, args.version, args.notes_output)
