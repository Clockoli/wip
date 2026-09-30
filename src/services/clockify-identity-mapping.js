import { validateClockifyUserMapping } from '../addons/clockify/user-mapping.js';

const GITHUB_MAPPING_KEYS = new Set(['sourceUserId', 'githubLogin']);
const SKIP_MAPPING_KEYS = new Set(['sourceUserId', 'skipped']);
const CREDENTIAL_KEY = /(?:authorization|authentication|auth|credential|cookie|password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|session|header|bearer)/i;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const MAX_MAPPINGS = 1000;
function fail(message) { throw new Error(`Invalid Clockify identity mapping: ${message}`); }
function plainDataObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object`); return value; }
function data(value, key, label) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label} fields must be data properties`); return descriptor.value; }
function dataArray(value, label) { if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be an array`); if (value.length < 1) fail(`${label} must not be empty`); if (value.length > MAX_MAPPINGS) fail(`too many ${label}`); const keys = Reflect.ownKeys(value); if (keys.length !== value.length + 1 || !keys.includes('length')) fail(`${label} must be a dense data array`); return Array.from({ length: value.length }, (_, index) => data(value, String(index), label)); }
function exactKeys(value, allowed, label) { for (const key of Reflect.ownKeys(value)) { if (typeof key !== 'string') fail(`unknown ${label} field: ${String(key)}`); if (CREDENTIAL_KEY.test(key)) fail('credential-bearing fields are forbidden'); if (!allowed.has(key)) fail(`unknown ${label} field: ${key}`); data(value, key, label); } for (const key of allowed) if (!Object.hasOwn(value, key)) fail(`missing ${label} field: ${key}`); }

function validateRequestedMappings(mappings) {
  const values = dataArray(mappings, 'mappings'); const githubLogins = new Set();
  return values.map(mapping => {
    plainDataObject(mapping, 'mapping');
    const sourceUserId = data(mapping, 'sourceUserId', 'mapping');
    if (typeof sourceUserId !== 'string' || !sourceUserId || sourceUserId.length > 200) fail('invalid source user ID');
    if (Object.hasOwn(mapping, 'skipped')) { exactKeys(mapping, SKIP_MAPPING_KEYS, 'mapping'); if (data(mapping, 'skipped', 'mapping') !== true) fail('skip decision must be true'); return { sourceUserId, skipped: true }; }
    exactKeys(mapping, GITHUB_MAPPING_KEYS, 'mapping'); const githubLogin = data(mapping, 'githubLogin', 'mapping');
    if (typeof githubLogin !== 'string' || !LOGIN_RE.test(githubLogin)) fail('invalid GitHub login');
    const normalizedLogin = githubLogin.toLowerCase(); if (githubLogins.has(normalizedLogin)) fail('duplicate GitHub login'); githubLogins.add(normalizedLogin);
    return { sourceUserId, githubLogin };
  });
}
function validateRosterBeforeResolution(sourceUsers, requestedMappings) { validateClockifyUserMapping(sourceUsers, requestedMappings.map((mapping, index) => mapping.skipped ? mapping : ({ sourceUserId: mapping.sourceUserId, githubUser: { id: index + 1, login: `placeholder-${index}` } }))); }
export async function resolveClockifyUserMappings({ sourceUsers, mappings, github }) {
  const requestedMappings = validateRequestedMappings(mappings); validateRosterBeforeResolution(sourceUsers, requestedMappings);
  const resolvedMappings = [];
  for (const mapping of requestedMappings) resolvedMappings.push(mapping.skipped ? mapping : { sourceUserId: mapping.sourceUserId, githubUser: await github.getUserIdentity(mapping.githubLogin) });
  return validateClockifyUserMapping(sourceUsers, resolvedMappings);
}
