import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('target packages preserve Chrome bytes and generate constrained Firefox and Safari manifests', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clockoli-target-test-'));
  try {
    const chrome = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    for (const target of ['chrome', 'firefox', 'safari']) {
      const output = path.join(directory, `${target}.zip`);
      execFileSync('python3', ['scripts/build-release.py', '--target', target, output], { cwd: root });
      const bytes = execFileSync('unzip', ['-p', output, 'manifest.json']);
      const manifest = JSON.parse(bytes);
      if (target === 'chrome') {
        assert.deepEqual(bytes, await readFile(path.join(root, 'manifest.json')));
      } else {
        assert.deepEqual(manifest.permissions, ['alarms', 'activeTab', 'scripting']);
        assert.equal('minimum_chrome_version' in manifest, false);
        assert.equal(manifest.web_accessible_resources.flatMap(item => item.resources).includes('_favicon/*'), false);
        assert.deepEqual(manifest.host_permissions, chrome.host_permissions);
        assert.deepEqual(manifest.optional_host_permissions, chrome.optional_host_permissions);
        assert.deepEqual(manifest.content_scripts, chrome.content_scripts);
      }
      if (target === 'firefox') {
        assert.deepEqual(manifest.background, { scripts: ['src/background/service-worker.js'], type: 'module' });
        assert.deepEqual(manifest.browser_specific_settings.gecko, {
          id: 'clockoli@clockoli.com', strict_min_version: '140.0',
          data_collection_permissions: { required: ['authenticationInfo', 'personallyIdentifyingInfo', 'browsingActivity', 'websiteContent'] },
        });
      }
      if (target === 'safari') {
        assert.deepEqual(manifest.background, chrome.background);
        assert.equal(manifest.browser_specific_settings.safari.strict_min_version, '18.0');
      }
      assert.ok(execFileSync('unzip', ['-Z1', output], { encoding: 'utf8' }).includes('src/background/service-worker.js\n'));
      const repeated = path.join(directory, `${target}-again.zip`);
      execFileSync('python3', ['scripts/build-release.py', '--target', target, repeated], { cwd: root });
      assert.deepEqual(await readFile(repeated), await readFile(output));
    }
    const invalid = spawnSync('python3', ['scripts/build-release.py', '--target', 'unknown', path.join(directory, 'invalid.zip')], { cwd: root });
    assert.notEqual(invalid.status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unpacked Firefox contains exactly the generated manifest inventory', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clockoli-unpacked-test-'));
  try {
    const unpacked = path.join(directory, 'extension');
    execFileSync('python3', ['scripts/build-release.py', '--target', 'firefox', '--unpacked', unpacked], { cwd: root });
    const { releaseInventory, validateReleaseInventory } = await import('../scripts/release-inventory.js');
    const bytes = await readFile(path.join(unpacked, 'manifest.json'));
    const manifest = JSON.parse(bytes);
    const files = await releaseInventory(unpacked, manifest);
    assert.ok(files.includes(manifest.background.scripts[0]));
    assert.equal((await validateReleaseInventory(unpacked, null, bytes)).files, files.length);
    const malicious = Buffer.from(JSON.stringify({ ...manifest, description: `ghp_${'x'.repeat(30)}` }));
    await assert.rejects(validateReleaseInventory(unpacked, files, malicious), /GitHub token detected in release entry manifest.json/);
    const repeated = spawnSync('python3', ['scripts/build-release.py', '--target', 'firefox', '--unpacked', unpacked], { cwd: root });
    assert.notEqual(repeated.status, 0, 'unpacked output must not merge with an existing directory');
    const inRepository = spawnSync('python3', ['scripts/build-release.py', path.join(root, 'scripts/forbidden-output.zip')], { cwd: root, encoding: 'utf8' });
    assert.notEqual(inRepository.status, 0);
    assert.match(inRepository.stderr, /Build output must be outside the repository/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Firefox signing rejects incomplete credentials before building or contacting AMO', () => {
  const environment = { ...process.env, AMO_JWT_ISSUER: 'test-issuer' };
  delete environment.AMO_JWT_SECRET;
  const result = spawnSync(process.execPath, ['scripts/firefox.js', 'sign', '/tmp/clockoli-signing-test'], { cwd: root, env: environment, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required environment variable: AMO_JWT_SECRET/);
  assert.equal(result.stdout, '');
});
