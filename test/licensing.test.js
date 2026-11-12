import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseInventory } from '../scripts/release-inventory.js';
import { targetManifest } from '../scripts/target-manifest.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(path.join(root, name), 'utf8');
const legal = JSON.parse(read('scripts/legal-files.json'));

test('original Clockoli code declares GPLv3 only and preserves upstream licenses', () => {
  assert.match(read('LICENSE'), /^GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007/);
  assert.ok(read('COPYRIGHT').startsWith('Copyright (c) 2026 Manticore Software LTD (https://manticoresearch.com)'));
  assert.match(read('CONTRIBUTING.md'), /Manticore Software LTD/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /Third-party code retains its own copyright/);
  assert.match(read('LICENSES/Apache-2.0.txt'), /^Apache License\nVersion 2.0/);
  assert.match(read('LICENSES/Primer-MIT.txt'), /Copyright \(c\) 2018 GitHub Inc\./);
  assert.match(read('LICENSES/jsPDF-MIT.txt'), /James Hall/);
  assert.match(read('LICENSES/Zlib.txt'), /zlib License/);
  assert.equal(JSON.parse(read('package.json')).license, 'GPL-3.0-only');
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].license, 'GPL-3.0-only');
  assert.equal(JSON.parse(read('packages/task-timeline-component/package.json')).license, 'GPL-3.0-only');
  assert.equal(JSON.parse(read('package-lock.json')).packages['packages/task-timeline-component'].license, 'GPL-3.0-only');
  assert.match(read('README.md'), /GPL-3\.0-only/);
  assert.match(read('src/styles/github-primer.css'), /^\/\* Adapted GitHub Primer design tokens/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /html2pdf\.js 0\.14\.0/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /DOMPurify 3\.3\.1/);
  const notices = read('LICENSES/PDF-npm-dependencies.txt');
  assert.equal((notices.match(/^Package: /gm) || []).length, 23);
  for (const dependency of ['canvg', 'core-js', 'fflate', 'dompurify', 'jspdf', 'pako'])
    assert.match(notices, new RegExp('Package: ' + dependency + '@'));
  assert.match(notices, /File: node_modules\/rgbcolor\/FEEL-FREE\.md/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /TaskTimeline.*Clockoli-owned/s);
});

test('every browser distribution contains complete project and third-party legal files', async () => {
  const source = JSON.parse(read('manifest.json'));
  for (const browser of ['chrome', 'firefox', 'safari']) {
    const files = await releaseInventory(root, targetManifest(source, browser));
    for (const item of legal) {
      assert.ok(files.includes(item), `${browser} package must include ${item}`);
    }
    assert.ok(files.includes('src/vendor/html2pdf.LICENSE.txt'));
    assert.ok(files.includes('src/vendor/html2pdf.bundle.min.js'));
  }
});

test('compiled PDF dependencies have pinned editable upstream source snapshots', () => {
  const sources = JSON.parse(read('scripts/pdf-upstream-sources.json'));
  const expected = [
    'base64-arraybuffer', 'canvg', 'css-line-break', 'dompurify', 'fast-png',
    'fflate', 'html2canvas', 'iobuffer', 'jspdf', 'stackblur-canvas',
    'svg-pathdata', 'text-segmentation', 'utrie',
  ];
  assert.deepEqual(sources.map(item => item.name), expected);
  for (const item of sources) {
    assert.match(item.commit, /^[0-9a-f]{40}$/);
    assert.match(item.source, /^src\/.+\.(?:js|ts)$/);
    assert.match(item.repo, /^[\w.-]+\/[\w.-]+$/);
    assert.match(item.tag, /^[\w.-]+$/);
  }
});

test('PDF bundle is pinned to a single documented upstream modification', () => {
  execFileSync(process.execPath, ['scripts/verify-html2pdf-source.mjs'],
    { cwd: root, stdio: 'pipe' });
  const vendor = readFileSync(path.join(root, 'src/vendor/html2pdf.bundle.min.js'));
  assert.equal(createHash('sha256').update(vendor).digest('hex'),
    '2be8dd6f51226c102898621d20c355cf4da81d596846622ddb13b5b55709496e');
  assert.match(read('THIRD_PARTY_NOTICES.md'), /29a31027d105782f10918bbf7fcada67488199dc/);
});

test('release and Firefox signing supply version-matched source archives', () => {
  const workflow = read('.github/workflows/release.yml');
  const signing = read('scripts/firefox.js');
  const packaging = read('scripts/package-source.py');
  assert.match(workflow, /python3 scripts\/package-source\.py "\$RELEASE_REF"/);
  assert.match(signing, /scripts\/package-source\.py', 'HEAD'/);
  assert.match(packaging, /--omit=dev/);
  assert.match(packaging, /UPSTREAM_COMMIT = "29a31027d105782f10918bbf7fcada67488199dc"/);
  assert.match(packaging, /source\.replace\(legacy, b"\{\}"\) != vendored/);
  assert.doesNotThrow(() => execFileSync('python3', ['scripts/package-source.py', '--help'],
    { cwd: root, stdio: 'pipe' }));
});

test('native Safari extension bundle preserves all license file bytes', () => {
  execFileSync('python3', ['scripts/test-safari-licenses.py'], { cwd: root, stdio: 'pipe' });
});

test('dry-run release validation preserves matching sources and Safari PKG export', () => {
  const release = read('.github/workflows/release.yml');
  const safari = read('scripts/build-safari.py');
  const source = read('scripts/package-source.py');
  const signing = read('scripts/firefox.js');
  assert.doesNotMatch(release, /REPO_PRIVATE/);
  assert.match(release, /pull_request:/);
  assert.match(release, /dry_run:/);
  assert.match(release, /sign_safari:/);
  assert.match(release, /preview:/);
  assert.match(release, /needs\.package\.outputs\.dry_run != 'true'/);
  assert.match(release, /scripts\/validate-release-assets\.py/);
  assert.doesNotThrow(() => execFileSync('python3', ['scripts/validate-release-assets.py', '--help'],
    { cwd: root, stdio: 'pipe' }));
  assert.match(release, /gh release create/);
  assert.match(release, /gh release upload/);
  assert.match(release, /gh release edit/);
  assert.match(release, /--verify-tag/);
  assert.match(release, /scripts\/verify-pdf-rebuild\.py/);
  assert.match(release, /scripts\/generate-pdf-notices\.py/);
  assert.match(safari, /for method in \['developer-id', 'app-store-connect'\]/);
  assert.match(safari, /pkgutil', '--check-signature'/);
  assert.match(safari, /Clockoli-\{version\}-safari\.pkg/);
  assert.match(safari, /'destination': 'export'/);
  assert.doesNotMatch(safari, /\b(?:transporter|altool|upload-to-app-store)\b/i);
  assert.match(release, /Clockoli-\$VERSION-safari\.pkg/);
  assert.doesNotMatch(release, /\.pkg files (?:are forbidden|must not be published)/);
  assert.ok(safari.includes('verify_app_licenses(app)'));
  assert.match(release, /build-release\.py --release-ref "\$RELEASE_REF"/);
  assert.match(release, /--target firefox --release-ref "\$RELEASE_REF"/);
  assert.match(release, /--target safari --release-ref "\$RELEASE_REF"/);
  assert.match(read('scripts/validate-release-assets.py'), /safari-extension\.zip/);
  assert.match(release, /build-safari\.py --release-ref "\$RELEASE_REF"/);
  assert.ok(safari.includes('Signed Safari distributions require --release-ref'));
  assert.ok(source.includes('check_clean_ref(ref)'));
  assert.ok(source.includes('validate_pdf_source(repository, contents["src/vendor/html2pdf.bundle.min.js"])'));
  assert.ok(source.includes('PUBLIC_ROOT'));
  assert.ok(signing.includes('Firefox signing requires a clean Git working tree'));
  assert.ok(signing.includes('verify-pdf-rebuild.py'));
  assert.ok(signing.includes('generate-pdf-notices.py'));
  const ci = read('.github/workflows/ci.yml');
  assert.ok(ci.includes('generate-pdf-notices.py'));
  assert.ok(ci.includes('verify-pdf-rebuild.py'));
  assert.ok(ci.includes('pdf-rebuild:'));
  assert.doesNotThrow(() => execFileSync('python3', ['scripts/verify-pdf-rebuild.py', '--help'],
    { cwd: root, stdio: 'pipe' }));
  assert.ok(ci.includes('--check'));
  assert.match(ci, /build-release\.py --release-ref HEAD/);
  assert.match(ci, /--target firefox --release-ref HEAD/);
  assert.match(ci, /build-safari\.py --release-ref HEAD/);
});

test('Corresponding Source archive excludes internal plans and rejects credentials', () => {
  execFileSync('python3', ['scripts/test-source-policy.py'], { cwd: root, stdio: 'pipe' });
});

test('release-ref guards reject dirty and mismatched Git checkouts', () => {
  execFileSync('python3', ['scripts/test-release-ref.py'], { cwd: root, stdio: 'pipe' });
});
