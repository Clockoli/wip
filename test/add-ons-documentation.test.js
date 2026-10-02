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
  assert.match(addOns, /native Export menu.*Save as CSV/i);
  assert.match(addOns, /does not invoke Clockify APIs directly/i);
  assert.match(addOns, /preview expires after one hour/i);
  assert.match(addOns, /temporary, privileged extension IndexedDB storage/i);
  assert.match(addOns, /not constrained by `chrome\.storage\.session`’s quota/i);
  assert.match(addOns, /content scripts do not access extension storage/i);
  assert.match(addOns, /For each person you want to import, select a GitHub account or enter its login/i);
  assert.match(addOns, /Repository membership is only a suggestion, not a requirement/i);
  assert.match(addOns, /\*\*Skip this person\*\* selected for anyone you do not want to import/i);
  assert.match(addOns, /invitations require a separate explicit confirmation and are never sent automatically/i);
  assert.match(addOns, /\*\*CSV migration\*\*.*\*\*Page to page migration\*\*/i);
  assert.match(addOns, /non-navigable `owner\/project\/task-slug` identity/i);

  assert.match(addOns, /isolated `clockoli\/users\/<GitHub ID>` branch, with ownership metadata checked before writing/i);
  assert.match(addOns, /configured user's records remain in their configured writer branch/i);

  assert.match(readme, /docs\/add-ons\.md/);
  assert.match(documentationIndex, /add-ons\.md/i);
  assert.match(privacy, /Clockify/i);
  assert.match(privacy, /untrusted/i);
  assert.match(privacy, /core retains all GitHub\/storage privileges/i);
});
