#!/usr/bin/env python3
"""Check that public source archives omit internal files and reject secrets."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("clockoli_source", ROOT / "scripts/package-source.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

for path in ("LICENSE", "manifest.json", "src/domain/records.js",
             "packages/task-timeline-component/vendor/timeline-component.js",
             "scripts/build-release.py", "docs/data-format-v1.md"):
    assert module.public_file(path), path
for path in ("AGENTS.md", "IMPLEMENTATION_PLAN.md", ".env", "src/.env",
             "config/secrets.json", ".github/SECURITY_INTERNAL.md"):
    assert not module.public_file(path), path

for example in (
    b'-----BEGIN ' + b'RSA PRIVATE KEY-----',
    b'github_pat_' + b'A' * 22,
    b'ghp_' + b'x' * 30,
    b'AKIA' + b'X' * 16,
    b'client_secret = "' + b'q' * 32 + b'"',
):
    try:
        module.validate_clockoli_source('src/secret.txt', example)
    except ValueError:
        pass
    else:
        raise AssertionError('Source archive did not reject a secret pattern')
module.validate_clockoli_source("README.md", b'GPL-3.0-only copyright notices')
print("Source archive allowlist and secret scanner tests passed")
