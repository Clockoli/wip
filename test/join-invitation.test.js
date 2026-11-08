import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJoinRepository, parseClockoliInvitationUrl, discoverClockoliInvitations, clockoliInvitationLink } from '../src/domain/join-invitation.js';

test('Clockoli invitation URLs match the published fragment-only contract', () => {
  assert.equal(parseClockoliInvitationUrl('https://clockoli.com/join/#repo=acme%2Ftime-data'), 'acme/time-data');
  assert.equal(parseClockoliInvitationUrl('https://clockoli.com/join#repo=Some-Org%2Fclockoli_data'), 'Some-Org/clockoli_data');
  assert.equal(clockoliInvitationLink('acme/time-data'), 'https://clockoli.com/join#repo=acme%2Ftime-data');
  assert.equal(validateJoinRepository('A/' + 'x'.repeat(100)), 'A/' + 'x'.repeat(100));
});

test('do not trust arbitrary origins, malformed or ambiguous invitation links', () => {
  for (const url of [
    'https://clockoli.com.evil.test/join#repo=acme%2Ftime-data',
    'https://evil.test/join#repo=acme%2Ftime-data',
    'http://clockoli.com/join#repo=acme%2Ftime-data',
    'https://clockoli.com@evil.test/join#repo=acme%2Ftime-data',
    'https://clockoli.com:8443/join#repo=acme%2Ftime-data',
    'https://clockoli.com/other#repo=acme%2Ftime-data',
    'https://clockoli.com/join?repo=acme%2Ftime-data',
    'https://clockoli.com/join/#repo=',
    'https://clockoli.com/join/#repo=acme',
    'https://clockoli.com/join/#repo=acme%2Frepo%2Fextra',
    'https://clockoli.com/join/#repo=acme%252Frepo',
    'https://clockoli.com/join/#repo=acme%2Frepo&extra=1',
    'https://clockoli.com/join/#repo=acme%2Frepo&repo=x%2Fy',
    'https://clockoli.com/join/#repo=%3Cscript%3E%2Frepo',
    'https://clockoli.com/join/#repo=acme%2Fr%20s',
    'https://clockoli.com/join/#repo=acme%2F.',
    'https://clockoli.com/join/#repo=acme%2F..',
    'https://clockoli.com/join/#repo=-invalid%2Frepo',
    'https://clockoli.com/join/#repo=invalid-%2Frepo',
    'https://clockoli.com/join/#repo=acme%5Crepo',
    'https://clockoli.com/join/#repo=acme%2F' + 'r'.repeat(101),
    'https://clockoli.com/join/#repo=' + 'a'.repeat(40) + '%2Frepo',
    'https://clockoli.com/join/#repo=' + 'a'.repeat(1000),
  ]) assert.equal(parseClockoliInvitationUrl(url), '', url);
  assert.equal(clockoliInvitationLink('bad/name/extra'), '');
  assert.equal(parseClockoliInvitationUrl(null), '');
});

test('tab discovery deduplicates case-insensitively and never trusts pending or unrelated URLs', () => {
  assert.deepEqual(discoverClockoliInvitations([
    { url: 'https://clockoli.com/join/#repo=acme%2Ftime-data' },
    { url: 'https://clockoli.com/join#repo=ACME%2Ftime-data' },
    { url: 'https://clockoli.com/join/#repo=beta%2Fdata' },
    { url: 'https://clockoli.com.evil.test/join/#repo=other%2Fdata' },
    { pendingUrl: 'https://clockoli.com/join/#repo=not%2Fcommitted' },
    { url: 'chrome-extension://clockoli/src/options/options.html' },
  ]), ['acme/time-data', 'beta/data']);
});
