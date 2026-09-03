import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const worker = read('src/background/service-worker.js');
const content = read('src/content/github.js');
const policy = read('src/background/message-policy.js');

test('toolbar opens the same full-width tracking surface on GitHub and other HTTP(S) pages', () => {
  assert.equal(manifest.action?.default_popup, undefined);
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('scripting'));

  assert.match(worker, /async function toggleActionSurface\(tab\)/);
  assert.match(worker, /chrome\.scripting\.executeScript\(\{[\s\S]*target: \{ tabId: tab\.id \}[\s\S]*globalThis\.__CLOCKOLI_ACTION_SURFACE__ = true/);
  assert.match(worker, /files: \['src\/domain\/recovery-actions\.js', 'src\/content\/elastic-timeline-editor\.js', 'src\/content\/github\.js'\]/);
  assert.match(worker, /chrome\.action\.onClicked\.addListener\(tab => \{[\s\S]*toggleActionSurface\(tab\)/);
  assert.doesNotMatch(worker, /restoreActionPopup|REGISTER_GITHUB_ACTION_SURFACE/);

  assert.match(content, /const actionSurfaceMode = globalThis\.__CLOCKOLI_ACTION_SURFACE__ === true/);
  assert.match(content, /else if \(actionSurfaceMode\) \{[\s\S]*toggleFullWidthPopup\(\)/);
  assert.match(content, /renderMenu\(\{ compact: true, onClose: \(\) => closeFullWidthPopup\(\) \}\)/);
  assert.match(content, /:host\(\.full-width-popup-surface\) \.full-width-popup \{ width:100vw; max-width:none/);
  assert.doesNotMatch(policy, /REGISTER_GITHUB_ACTION_SURFACE/);
});
