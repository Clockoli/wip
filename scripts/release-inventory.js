import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const MANIFEST = 'manifest.json';
const VIRTUAL_RESOURCES = new Set(['_favicon/*']);
const RUNTIME_PAGE_ENTRIES = ['src/clockify-migration/preview.html', 'src/reports/reports.html', 'src/tasks/tasks.html', 'src/times/times.html'];
const EXCLUDED_SEGMENTS = new Set(['test', 'tests', 'docs', 'scripts', 'node_modules', '.git']);
const SECRET_PATTERNS = [
  { label: 'GitHub token', pattern: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/ },
  { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'client secret assignment', pattern: /\bclient[_-]?secret\s*[:=]\s*["'][^"']+["']/i },
];

function normalizeRelative(value) {
  const clean = String(value).split('#', 1)[0].split('?', 1)[0];
  if (!clean || /^(?:[a-z]+:|\/\/|#)/i.test(clean)) return null;
  return clean.replace(/^\//, '');
}

function localReferences(file, text) {
  const references = [];
  const extension = path.extname(file);
  if (extension === '.js') {
    for (const match of text.matchAll(/(?<![\w$.])(?:from\s+|import\s+)["']([^"']+)["']/g)) references.push(match[1]);
  } else if (extension === '.html') {
    for (const match of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) references.push(match[1]);
  } else if (extension === '.css') {
    for (const match of text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) references.push(match[1]);
    for (const match of text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/g)) references.push(match[1]);
  }
  return references.map(normalizeRelative).filter(Boolean).map(reference => path.posix.normalize(path.posix.join(path.posix.dirname(file), reference)));
}

function manifestEntries(manifest) {
  const entries = [
    ...Object.values(manifest.icons || {}),
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.action?.default_icon || {}),
    manifest.options_page,
    ...RUNTIME_PAGE_ENTRIES,
    ...(manifest.content_scripts || []).flatMap(item => [...(item.js || []), ...(item.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap(item => item.resources || []),
  ];
  return entries.filter(entry => entry && !VIRTUAL_RESOURCES.has(entry));
}

function assertRuntimePath(file) {
  const parts = file.split('/');
  if (file !== MANIFEST && parts[0] !== 'src') throw new Error(`Release entry must be manifest.json or under src/: ${file}`);
  if (parts.some(part => EXCLUDED_SEGMENTS.has(part))) throw new Error(`Development-only path reached the release inventory: ${file}`);
  if (/\.(?:map|log|tmp|rec|test\.[^.]+)$/i.test(file) || /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(file)) {
    throw new Error(`Forbidden release entry: ${file}`);
  }
}

export async function releaseInventory(root) {
  const manifest = JSON.parse(await readFile(path.join(root, MANIFEST), 'utf8'));
  const pending = [...manifestEntries(manifest)];
  const files = new Set([MANIFEST]);
  while (pending.length) {
    const file = pending.shift();
    if (!file || files.has(file)) continue;
    assertRuntimePath(file);
    const absolute = path.join(root, file);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) throw new Error(`Release dependency is missing: ${file}`);
    files.add(file);
    const text = await readFile(absolute, 'utf8');
    for (const reference of localReferences(file, text)) {
      assertRuntimePath(reference);
      if (!files.has(reference)) pending.push(reference);
    }
  }
  const inventory = [...files].sort();
  for (const file of inventory) assertRuntimePath(file);
  return inventory;
}

export async function validateReleaseInventory(root, inventory = null) {
  inventory ||= await releaseInventory(root);
  let bytes = 0;
  for (const file of inventory) {
    const absolute = path.join(root, file);
    const content = await readFile(absolute);
    bytes += content.byteLength;
    const text = content.toString('utf8');
    for (const { label, pattern } of SECRET_PATTERNS) {
      if (pattern.test(text)) throw new Error(`${label} detected in release entry ${file}`);
    }
  }
  return { files: inventory.length, bytes };
}
