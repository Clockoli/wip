import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const url = new URL(entry.name, directory);
  return entry.isDirectory() ? walk(new URL(`${url.href}/`)) : [url];
});
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

const retiredProductNames = [
  ['repo', 'clock'].join(''),
  ['github-private', 'time-tracker'].join('-'),
  ['private time', ' tracker'].join(''),
];
const assertClockoliOnly = text => {
  const normalized = text.toLowerCase();
  for (const retired of retiredProductNames) assert.equal(normalized.includes(retired), false);
};

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
  assertClockoliOnly(runtimeText);
  assert.match(runtimeText, /Clockoli/);
});

test('GitHub page trigger uses the green Clockoli mark instead of the stopwatch icon', () => {
  const content = read('src/content/github.js');
  assert.match(content, /function clockoliMark\(/);
  assert.match(content, /main\.append\(clockoliMark\(22\)\)/);
  assert.match(content, /\.clockoli-mark/);
  assert.doesNotMatch(content, /main\.append\(icon\('stopwatch', STOPWATCH_PATH\)\)/);
});

test('storage, branch, DOM, settings, and GitHub App identities are Clockoli-only', () => {
  const product = [
    'src/content/github.js', 'src/domain/local-settings.js', 'src/tasks/tasks.js',
    'src/services/github-app-onboarding.js', 'src/services/user-storage-branch.js',
    'src/config/github-app.js',
  ].map(read).join('\n');
  for (const value of [
    'clockoli-root', 'clockoli-popup-root', 'clockoli-times-root',
    'clockoli.tasks.period', 'clockoli-settings', 'clockoli/users/',
    '.clockoli/config.json', '.clockoli/user.json',
  ]) assert.match(product, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assertClockoliOnly(product);
});

test('documentation and clone instructions use Clockoli GitHub coordinates', () => {
  const docs = ['README.md', 'docs/README.md', 'docs/getting-started.md', 'docs/features.md',
    'docs/data-and-privacy.md', 'docs/time-data-repository.md', 'docs/troubleshooting.md',
    'docs/why-clockoli.md', 'docs/spec-compliance.md'].map(read).join('\n');
  assertClockoliOnly(docs);
  assert.match(docs, /github\.com[:/]clockoli\/clockoli/);
  assert.ok(fs.existsSync(new URL('../docs/why-clockoli.md', import.meta.url)));
});

test('tracked product text contains only the Clockoli brand namespace', () => {
  const files = [
    ...walk(new URL('../src/', import.meta.url)),
    ...walk(new URL('../test/', import.meta.url)),
    ...walk(new URL('../docs/', import.meta.url)),
    new URL('../README.md', import.meta.url),
    new URL('../IMPLEMENTATION_PLAN.md', import.meta.url),
  ];
  const findings = files.filter(file => retiredProductNames.some(retired => fs.readFileSync(file, 'utf8').toLowerCase().includes(retired)));
  assert.deepEqual(findings.map(file => file.pathname), []);
});
