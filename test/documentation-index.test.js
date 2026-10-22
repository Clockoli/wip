import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// docs/README.md is the documentation index on GitHub and the source of the
// clockoli.com/docs categories: `## Category` headings group
// `- [Title](file.md): description` entries, in order.
const docsDirectory = new URL('../docs/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, docsDirectory), 'utf8');
const index = read('README.md');
const maintainerDocs = new Set(['spec-compliance.md', 'browser-releases.md']);

function entries() {
  const found = [];
  let category = null;
  for (const line of index.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) { category = heading[1].trim(); continue; }
    const entry = line.match(/^- \[([^\]]+)\]\(([\w-]+\.md)\):\s*(.+)$/);
    if (entry) found.push({ category, title: entry[1], file: entry[2], description: entry[3].trim() });
  }
  return found;
}

// Same algorithm as github-slugger (GitHub's heading anchors and rehype-slug on
// clockoli.com) for the punctuation the docs use.
function anchors(markdown) {
  const seen = new Map();
  const result = new Set();
  let fence = null;
  for (const line of markdown.split('\n')) {
    const opens = line.match(/^\s{0,3}(```+|~~~+)/);
    if (opens) { fence = fence ? (opens[1][0] === fence ? null : fence) : opens[1][0]; continue; }
    if (fence) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const text = heading[1].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '');
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}

test('documentation index lists every user guide once, in a category, with a short description', () => {
  const listed = entries();
  assert.ok(listed.length > 0);
  const files = listed.map(entry => entry.file);
  assert.equal(new Set(files).size, files.length, 'no guide is listed twice');
  for (const entry of listed) {
    assert.ok(entry.category, `${entry.file} sits under a ## category heading`);
    assert.ok(fs.existsSync(new URL(entry.file, docsDirectory)), `${entry.file} exists`);
    assert.ok(!maintainerDocs.has(entry.file), `${entry.file} is maintainer reference, not a user guide entry`);
    // The site uses the description as the page meta description (max 160).
    assert.ok(entry.description.length <= 160, `${entry.file} description is ${entry.description.length} chars`);
  }
  const userDocs = fs.readdirSync(docsDirectory).filter(name => name.endsWith('.md') && name !== 'README.md' && !maintainerDocs.has(name));
  assert.deepEqual(userDocs.filter(name => !files.includes(name)), [], 'every user guide appears in the index');
  for (const file of files) {
    const title = read(file).match(/^#\s+(.+)$/m)?.[1] ?? '';
    // The site renders `<h1> — Clockoli` as the page title (max 60).
    assert.ok(title && `${title} — Clockoli`.length <= 60, `${file} has a short h1`);
  }
  assert.match(index, /\[[^\]]+\]\(\.\.\/CONTRIBUTING\.md\)/);
});

test('relative documentation links and heading anchors resolve', () => {
  const files = fs.readdirSync(docsDirectory).filter(name => name.endsWith('.md'));
  const anchorsByFile = new Map(files.map(file => [file, anchors(read(file))]));
  const broken = [];
  for (const file of files) {
    for (const [, href] of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(href)) continue;
      const [path, hash] = href.split('#');
      if (path.startsWith('../')) {
        if (!fs.existsSync(new URL(path, docsDirectory))) broken.push(`${file}: ${href}`);
        continue;
      }
      const target = path || file;
      if (!target.endsWith('.md')) continue;
      if (!anchorsByFile.has(target)) broken.push(`${file}: ${href}`);
      else if (hash && !anchorsByFile.get(target).has(hash)) broken.push(`${file}: ${href}`);
    }
  }
  assert.deepEqual(broken, []);
});
