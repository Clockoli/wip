import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('first-party packaged add-ons have a constrained, user-disclosed contract', async () => {
  const [addOns, readme, privacy, documentationIndex] = await Promise.all([
    read('docs/add-ons.md'),
    read('README.md'),
    read('docs/data-and-privacy.md'),
    read('docs/README.md'),
  ]);

  assert.match(addOns, /first-party,?\s+\*\*packaged-only\*\*/i);
  assert.match(addOns, /Clockoli ships first-party/i);
  assert.match(addOns, /shipped in (?:Clockoli )?extension releases/i);
  assert.match(addOns, /user must[^\n]*enable/i);
  assert.match(addOns, /host permission/i);
  assert.match(addOns, /privileged core/i);
  assert.match(addOns, /untrusted provider adapter/i);
  assert.match(addOns, /(?:never )?collect(?:s|ion)? or persist(?:s|ence)? provider credentials/i);
  assert.match(addOns, /`id`, `version`, `title`, `description`, `requested origins`, and `capabilities`/i);
  assert.match(addOns, /`import_completed_records`/);
  assert.match(addOns, /forbidden/i);
  assert.match(addOns, /remote code/i);
  assert.match(addOns, /arbitrary messages/i);
  assert.match(addOns, /arbitrary GitHub calls/i);
  assert.match(addOns, /disabl\w* .*stops integration/i);
  assert.match(addOns, /never deletes imported records/i);

  assert.match(addOns, /Clockify migration add-on/i);
  assert.match(addOns, /completed Detailed Report result/i);
  assert.match(addOns, /user-opened authenticated Clockify tab/i);
  assert.match(addOns, /tokens, cookies, request headers, request bodies, report-task markers, and raw provider responses are never collected or retained/i);
  assert.match(addOns, /content adapter is untrusted/i);
  assert.match(addOns, /revalidates and normalizes/i);
  assert.match(addOns, /session-only preview/i);
  assert.match(addOns, /chrome\.storage\.session.*privileged extension code/i);
  assert.match(addOns, /content scripts do not access extension storage/i);
  assert.match(addOns, /explicitly map each person.*explicitly skip/i);
  assert.match(addOns, /does not invoke Clockify Export/i);
  assert.match(addOns, /does not invoke Clockify Export or issue direct provider requests/i);
  assert.match(addOns, /`clockoli\/users\/\{github-id\}`/);

  assert.match(readme, /docs\/add-ons\.md/);
  assert.match(documentationIndex, /add-ons\.md/i);
  assert.match(privacy, /Clockify/i);
  assert.match(privacy, /untrusted/i);
  assert.match(privacy, /core retains all GitHub\/storage privileges/i);
});
