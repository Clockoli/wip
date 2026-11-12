#!/usr/bin/env python3
"""Bundle tagged Clockoli source, pinned PDF upstream source, and production dependencies.

The resulting source archive accompanies browser releases under GPLv3 section 6(d).
Only a pinned, verified upstream revision is used. npm scripts are not executed.
"""
import argparse
import hashlib
import io
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM_URL = "https://github.com/eKoopmans/html2pdf.js.git"
UPSTREAM_TAG = "v0.14.0"
UPSTREAM_COMMIT = "29a31027d105782f10918bbf7fcada67488199dc"
UPSTREAM_SHA256 = "9563c45f032179c73454293a649929e60fc24c05a326e8ab2811cfa8f25c3607"
CLOCKOLI_SHA256 = "2be8dd6f51226c102898621d20c355cf4da81d596846622ddb13b5b55709496e"
PREFIX = "third_party/html2pdf.js-v0.14.0/"
SOURCE_PREFIX = "third_party/pdf-source-repositories/"
PUBLIC_ROOT = frozenset({
    "COPYRIGHT", "LICENSE", "README.md", "CONTRIBUTING.md", "CHANGELOG.md",
    "THIRD_PARTY_NOTICES.md", "manifest.json", "package.json", "package-lock.json",
})
PUBLIC_PREFIXES = ("src/", "packages/", "scripts/", "test/", "docs/", "LICENSES/", ".github/workflows/")
BLOCKED_SUFFIXES = (".env", ".pem", ".key", ".p8", ".p12", ".sqlite", ".db", ".log")
SECRET_PATTERNS = (
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rb"\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b"),
    re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(rb"(?i)\b(?:client[_-]?secret|api[_-]?key|auth[_-]?token)\s*[=:]\s*['\\\"][^'\\\"]{20,}"),
)



def run(*args, cwd=ROOT, capture=False):
    return subprocess.run(
        args, cwd=cwd, check=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    ).stdout


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def check_clean_ref(ref):
    head = run("git", "rev-parse", "HEAD", capture=True).decode().strip()
    selected = run("git", "rev-parse", ref + "^{commit}", capture=True).decode().strip()
    if head != selected:
        raise ValueError("The source ZIP must be generated from the checked-out HEAD commit")
    status = run("git", "status", "--porcelain", "--untracked-files=normal", capture=True)
    if status.strip():
        raise ValueError("Source packaging requires a clean working tree; commit or discard changes first")
    return head


def public_file(name):
    if name.endswith("/") or name.endswith(BLOCKED_SUFFIXES) or "/.env" in name:
        return False
    return name in PUBLIC_ROOT or name.startswith(PUBLIC_PREFIXES)


def validate_clockoli_source(name, data):
    for pattern in SECRET_PATTERNS:
        if pattern.search(data):
            raise ValueError("Potential secret in source archive file: " + name)


def validate_pdf_source(upstream, vendored):
    if run("git", "rev-parse", "HEAD", cwd=upstream, capture=True).decode().strip() != UPSTREAM_COMMIT:
        raise ValueError("Unexpected html2pdf upstream commit")
    source = (upstream / "dist/html2pdf.bundle.min.js").read_bytes()
    if sha256(source) != UPSTREAM_SHA256 or sha256(vendored) != CLOCKOLI_SHA256:
        raise ValueError("html2pdf source or vendored bundle checksum mismatch")
    legacy = b'Function("return this")()'
    if source.count(legacy) != 1 or source.replace(legacy, b"{}") != vendored:
        raise ValueError("Vendored html2pdf differs from upstream beyond the documented MV3 patch")
    for package in ("html2canvas", "jspdf", "dompurify"):
        if not (upstream / "node_modules" / package / "package.json").is_file():
            raise ValueError("Missing bundled runtime dependency source: " + package)


def add_pinned_dependency_sources(contents, temporary, lock):
    """Bundle exact upstream Git sources for npm packages shipping compiled JS.

    Installed npm package archives can omit the TypeScript/JavaScript source and
    build instructions. For the audited packages below, ship the full upstream
    Git snapshot instead; accept it only at the pinned commit and npm version.
    """
    manifest = json.loads(contents["scripts/pdf-upstream-sources.json"])
    seen = set()
    for spec in manifest:
        name, version = spec["name"], spec["version"]
        if (name in seen or not re.fullmatch(r"[a-z0-9-]+", name)
                or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version)
                or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", spec["repo"])
                or not re.fullmatch(r"[A-Za-z0-9_.-]+", spec["tag"])
                or not re.fullmatch(r"[0-9a-f]{40}", spec["commit"])
                or not spec["source"].startswith("src/")
                or ".." in Path(spec["source"]).parts):
            raise ValueError("Invalid or duplicate pinned PDF source entry: " + name)
        seen.add(name)
        installed = lock["packages"].get("node_modules/" + name)
        if not installed or installed.get("dev") or installed.get("version") != version:
            raise ValueError(f"Pinned PDF source {name}@{version} does not match the production lockfile")
        checkout = temporary / ("pdf-source-" + name)
        run("git", "clone", "--quiet", "--depth=1", "--branch", spec["tag"],
            "--single-branch", "https://github.com/" + spec["repo"] + ".git", str(checkout))
        revision = run("git", "rev-parse", "HEAD", cwd=checkout, capture=True).decode().strip()
        if revision != spec["commit"]:
            raise ValueError(f"Unexpected upstream source revision for {name}: {revision}")
        upstream_metadata = json.loads((checkout / "package.json").read_text())
        if upstream_metadata.get("name") != name or upstream_metadata.get("version") != version:
            raise ValueError("Upstream source package does not match pinned dependency: " + name)
        if not (checkout / spec["source"]).is_file():
            raise ValueError("Missing editable upstream source: " + name + "/" + spec["source"])
        # git archive, unlike copying a working tree, includes tracked source
        # only and retains the upstream build configuration and its lockfile.
        archive = run("git", "archive", "--format=zip", "HEAD", cwd=checkout, capture=True)
        destination = SOURCE_PREFIX + name + "-" + version + "/"
        with zipfile.ZipFile(io.BytesIO(archive)) as files:
            for relative in files.namelist():
                if not relative.endswith("/"):
                    contents[destination + relative] = files.read(relative)


def zip_entry(name, data):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    info.create_system = 3
    return info, data


def assemble(ref, target):
    check_clean_ref(ref)
    target = target.resolve()
    if target == ROOT or ROOT in target.parents:
        raise ValueError("Source ZIP must be created outside the repository")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="clockoli-source-", dir=target.parent) as tmp:
        temporary = Path(tmp)
        repository = temporary / "html2pdf"
        run("git", "clone", "--quiet", "--depth=1", "--branch", UPSTREAM_TAG,
            "--single-branch", UPSTREAM_URL, str(repository))
        # Lockfile-pinned packages, including bundled transitive modules.
        run("npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit",
            "--no-fund", cwd=repository)
        clockoli_zip = run("git", "archive", "--format=zip", ref, capture=True)
        contents = {}
        with zipfile.ZipFile(io.BytesIO(clockoli_zip)) as original:
            for name in original.namelist():
                if not public_file(name):
                    continue
                data = original.read(name)
                validate_clockoli_source(name, data)
                contents[name] = data
        # Verify the checked-in vendor used by the tagged release, not a separate worktree.
        validate_pdf_source(repository, contents["src/vendor/html2pdf.bundle.min.js"])
        add_pinned_dependency_sources(contents, temporary, json.loads((repository / "package-lock.json").read_text()))
        for file in repository.rglob("*"):
            if not file.is_file() or file.is_symlink():
                continue
            relative = file.relative_to(repository)
            if ".git" in relative.parts or (".bin" in relative.parts and "node_modules" in relative.parts):
                continue
            contents[PREFIX + relative.as_posix()] = file.read_bytes()
        expected = ("COPYRIGHT", "LICENSE", "THIRD_PARTY_NOTICES.md", "LICENSES/Apache-2.0.txt",
                    "LICENSES/Primer-MIT.txt", PREFIX + "package-lock.json",
                    PREFIX + "src/index.js",
                    PREFIX + "node_modules/dompurify/package.json",
                    PREFIX + "node_modules/html2canvas/package.json",
                    PREFIX + "node_modules/jspdf/package.json")
        for name in expected:
            if name not in contents:
                raise ValueError("Missing Corresponding Source component: " + name)
        archive_path = temporary / "source.zip"
        with zipfile.ZipFile(archive_path, "w") as archive:
            for name, data in sorted(contents.items()):
                info, value = zip_entry(name, data)
                archive.writestr(info, value)
        os.replace(archive_path, target)
        print(f"Created source archive: {target} ({len(contents)} files, {target.stat().st_size} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ref", help="Clockoli Git commit or release tag to archive")
    parser.add_argument("output", type=Path, help="ZIP path outside the repository")
    args = parser.parse_args()
    assemble(args.ref, args.output)
