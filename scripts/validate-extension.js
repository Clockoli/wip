import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fail = message => { throw new Error(message); };
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));
const manifest = JSON.parse(read('manifest.json'));

if (manifest.manifest_version !== 3) fail('Manifest V3 is required');
if (Number.parseInt(manifest.minimum_chrome_version, 10) < 102) fail('Chrome 102+ is the supported browser baseline');
if (manifest.background?.type !== 'module') fail('Background worker must be an ES module');
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://api.github.com/*'])) fail('API host permissions are broader than expected');
for (const permission of manifest.permissions || []) if (!['alarms', 'activeTab'].includes(permission)) fail(`Unexpected permission: ${permission}`);
if ((manifest.permissions || []).includes('storage')) fail('chrome.storage permission would expose persistent state to content scripts');

const referenced = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, 'src/reports/reports.html', 'src/tasks/tasks.html'];
for (const script of manifest.content_scripts || []) referenced.push(...script.js);
for (const file of referenced) if (!exists(file)) fail(`Manifest references missing file: ${file}`);

const htmlFiles = [manifest.action.default_popup, manifest.options_page, 'src/reports/reports.html', 'src/tasks/tasks.html'];
for (const file of htmlFiles) {
  const html = read(file);
  if (/<script(?![^>]+src=)/i.test(html)) fail(`Inline script is forbidden: ${file}`);
  const withoutSafeLinks = html.replace(/<a\b[^>]*\bhref=(['"])https:\/\/[^'"]+\1[^>]*>/gi, tag => {
    if (!/\btarget=(['"])_blank\1/i.test(tag) || !/\brel=(['"])[^'"]*\bnoreferrer\b[^'"]*\1/i.test(tag)) fail(`External link must use target="_blank" and rel="noreferrer": ${file}`);
    return tag.replace(/https:\/\/[^'"]+/i, '#external-link');
  });
  if (/https?:\/\//i.test(withoutSafeLinks)) fail(`Remote resource is forbidden: ${file}`);
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
  if (/\.(innerHTML|outerHTML)\s*=/.test(code)) fail(`Unsafe HTML assignment in ${file}`);
  if (/\beval\s*\(|new\s+Function\s*\(/.test(code)) fail(`Dynamic code execution in ${file}`);
}
const content = read('src/content/github.js');
if (/Authorization|Bearer|\btoken\b/i.test(content)) fail('Content script must not contain credential handling');

console.log(`Validated Manifest V3 extension: ${referenced.length} manifest files, ${jsFiles.length} JavaScript files.`);
