import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { targetManifest, TARGETS } from './target-manifest.js';

const root = process.cwd();
const fail = message => { throw new Error(message); };
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));
const sourceManifest = JSON.parse(read('manifest.json'));
const { values } = parseArgs({ options: { target: { type: 'string' } } });
const packageJson = JSON.parse(read('package.json'));

for (const target of values.target ? [values.target] : TARGETS) {
  const manifest = targetManifest(sourceManifest, target);
  if (manifest.version !== packageJson.version) fail('Manifest and package versions must match');

  if (manifest.manifest_version !== 3) fail('Manifest V3 is required');
  if (target === 'chrome' && Number.parseInt(manifest.minimum_chrome_version, 10) < 102) fail('Chrome 102+ is the supported browser baseline');
  if (manifest.background?.type !== 'module') fail('Background worker must be an ES module');
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://api.github.com/*', 'https://github.com/login/*', 'https://api.frankfurter.dev/*'])) fail('Host permissions must be limited to the GitHub API, OAuth login, and Frankfurter exchange-rate endpoints');
  const permissions = target === 'chrome' ? ['alarms', 'activeTab', 'favicon', 'scripting'] : ['alarms', 'activeTab', 'scripting'];
  for (const permission of manifest.permissions || []) if (!permissions.includes(permission)) fail(`Unexpected permission: ${permission}`);
  if ((manifest.permissions || []).includes('storage')) fail('chrome.storage permission would expose persistent state to content scripts');

  if (JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify(['https://app.clockify.me/*'])) fail('Optional hosts must be limited to Clockify');
  const actionPopup = manifest.action?.default_popup;
  const referenced = [manifest.background.service_worker, ...(manifest.background.scripts || []), actionPopup, manifest.options_page, 'src/reports/reports.html', 'src/tasks/tasks.html', 'src/times/times.html'].filter(Boolean);
  for (const script of manifest.content_scripts || []) referenced.push(...script.js);
  for (const file of referenced) if (!exists(file)) fail(`Manifest references missing file: ${file}`);

  const htmlFiles = [actionPopup, manifest.options_page, 'src/reports/reports.html', 'src/tasks/tasks.html', 'src/times/times.html'].filter(Boolean);
  for (const file of htmlFiles) {
    const html = read(file);
    if (/<script(?![^>]+src=)/i.test(html)) fail(`Inline script is forbidden: ${file}`);
    const withoutSafeLinks = html.replace(/<a\b[^>]*\bhref=(['"])https:\/\/[^'"]+\1[^>]*>/gi, tag => {
      if (!/\btarget=(['"])_blank\1/i.test(tag) || !/\brel=(['"])[^'"]*\bnoreferrer\b[^'"]*\1/i.test(tag)) fail(`External link must use target="_blank" and rel="noreferrer": ${file}`);
      return tag.replace(/https:\/\/[^'"]+/i, '#external-link');
    });
    if (/https?:\/\//i.test(withoutSafeLinks)) fail(`Remote resource is forbidden: ${file}`);
  }

  console.log(`Validated ${target} Manifest V3: ${referenced.length} manifest files.`);
}

const generatedBundles = new Set(['src/content/task-timeline-component.js']);
const reviewedBundleHashes = new Map([
  ['src/vendor/html2pdf.bundle.min.js', '2be8dd6f51226c102898621d20c355cf4da81d596846622ddb13b5b55709496e'],
]);
for (const [file, expected] of reviewedBundleHashes) {
  const actual = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  if (actual !== expected) fail(`Reviewed bundle hash mismatch: ${file}`);
}
const jsFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(relative);
    else if (entry.name.endsWith('.js')) jsFiles.push(relative);
  }
}
walk('src');
for (const file of jsFiles) {
  const code = read(file);
  if (!generatedBundles.has(file) && !reviewedBundleHashes.has(file) && /\.(innerHTML|outerHTML)\s*=/.test(code)) fail(`Unsafe HTML assignment in ${file}`);
  if (!generatedBundles.has(file) && /\beval\s*\(|\b(?:new\s+)?Function\s*\(/.test(code)) fail(`Dynamic code execution in ${file}`);
}
const content = read('src/content/github.js');
if (/Authorization|Bearer|\btoken\b/i.test(content)) fail('Content script must not contain credential handling');

console.log(`Validated extension source: ${jsFiles.length} JavaScript files.`);
