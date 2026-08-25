import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const runtimeText = [
  'manifest.json',
  'src/auth/github-app-auth.js', 'src/api/github-client.js', 'src/content/github.js',
  'src/options/options.html', 'src/options/options.js', 'src/popup/popup.html',
  'src/reports/reports.html', 'src/tasks/tasks.html', 'src/storage/chrome-store.js',
  'src/services/configuration.js', 'src/services/onboarding-coordinator.js',
  'src/services/github-app-onboarding.js', 'src/services/user-storage-branch.js',
  'src/times/times.html',
].map(read).join('\n');

test('visible extension identity is Clockoli with complete logo assets', () => {
  assert.equal(manifest.name, 'Clockoli');
  assert.equal(manifest.action.default_title, 'Clockoli');
  assert.deepEqual(manifest.icons, {
    16: 'src/assets/clockoli-16.png', 32: 'src/assets/clockoli-32.png',
    48: 'src/assets/clockoli-48.png', 128: 'src/assets/clockoli-128.png',
  });
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
  for (const file of ['src/assets/clockoli.svg', ...Object.values(manifest.icons)]) {
    assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), `${file} must exist`);
  }
  assert.doesNotMatch(runtimeText, /RepoClock/);
  assert.match(runtimeText, /Clockoli/);
});

test('GitHub page trigger uses the green Clockoli mark instead of the stopwatch icon', () => {
  const content = read('src/content/github.js');
  assert.match(content, /function clockoliMark\(/);
  assert.match(content, /main\.append\(clockoliMark\(22\)\)/);
  assert.match(content, /\.clockoli-mark/);
  assert.doesNotMatch(content, /main\.append\(icon\('stopwatch', STOPWATCH_PATH\)\)/);
});

test('rename preserves legacy storage, branch, DOM, and settings identities while using the Clockoli App', () => {
  const compatibility = [
    'src/content/github.js', 'src/domain/local-settings.js', 'src/tasks/tasks.js',
    'src/services/github-app-onboarding.js', 'src/services/user-storage-branch.js',
  ].map(read).join('\n');
  for (const value of [
    'repoclock-root', 'repoclock-popup-root', 'repoclock-times-root',
    'repoclock.tasks.period', 'repoclock-settings',
    'repoclock/users/',
  ]) assert.match(compatibility, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const storage = read('src/services/github-app-onboarding.js');
  const userStorage = read('src/services/user-storage-branch.js');
  assert.match(storage, /MARKER_PATH = '.clockoli\/config.json'/);
  assert.match(storage, /LEGACY_MARKER_PATH = '.repoclock\/config.json'/);
  assert.match(userStorage, /USER_METADATA_PATH = '.clockoli\/user.json'/);
  assert.match(userStorage, /LEGACY_USER_METADATA_PATH = '.repoclock\/user.json'/);
  const app = read('src/config/github-app.js');
  assert.match(app, /GITHUB_APP_SLUG = 'clockoli'/);
  assert.doesNotMatch(app, /GITHUB_APP_SLUG = 'repoclock'/);
});

test('downloaded settings use the Clockoli filename while preserving the legacy import format', () => {
  const source = read('src/options/options.js');
  const settings = read('src/domain/local-settings.js');
  assert.match(source, /clockoli-settings-/);
  assert.doesNotMatch(source, /repoclock-settings-/);
  assert.match(settings, /format: 'repoclock-settings'/);
});

test('documentation and clone instructions use Clockoli GitHub coordinates', () => {
  const docs = ['README.md', 'docs/README.md', 'docs/getting-started.md', 'docs/features.md',
    'docs/data-and-privacy.md', 'docs/time-data-repository.md', 'docs/troubleshooting.md',
    'docs/why-clockoli.md', 'docs/spec-compliance.md'].map(read).join('\n');
  assert.doesNotMatch(docs, /RepoClock/);
  assert.match(docs, /github\.com[:/]clockoli\/clockoli/);
  assert.equal(fs.existsSync(new URL('../docs/why-repoclock.md', import.meta.url)), false);
});
