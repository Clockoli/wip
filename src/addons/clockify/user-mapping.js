// This is a pure boundary between a normalized Clockify roster and an
// administrator-confirmed, already-resolved GitHub identity mapping.
const SOURCE_USER_KEYS = new Set(['userId', 'displayName', 'entryCount']);
const GITHUB_MAPPING_KEYS = new Set(['sourceUserId', 'githubUser']);
const SKIP_MAPPING_KEYS = new Set(['sourceUserId', 'skipped']);
const GITHUB_USER_KEYS = new Set(['id', 'login']);
const CREDENTIAL_KEY = /(?:authorization|authentication|auth|credential|cookie|password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|session|header|bearer)/i;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const MAX_SOURCE_USERS = 1000;
const MAX_SOURCE_ID_LENGTH = 200;
const MAX_DISPLAY_NAME_LENGTH = 300;

function fail(message) { throw new Error(`Invalid Clockify user mapping: ${message}`); }

function plainDataObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function data(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label} fields must be data properties`);
  return descriptor.value;
}

function exactKeys(value, allowed, label) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(`unknown ${label} field: ${String(key)}`);
    if (CREDENTIAL_KEY.test(key)) fail('credential-bearing fields are forbidden');
    if (!allowed.has(key)) fail(`unknown ${label} field: ${key}`);
    data(value, key, label);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) fail(`missing ${label} field: ${key}`);
  }
}

function dataArray(value, label, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be an array`);
  if (value.length < 1) fail(`${label} must not be empty`);
  if (value.length > maximum) fail(`too many ${label}`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) fail(`${label} must be a dense data array`);
  const values = [];
  for (let index = 0; index < value.length; index += 1) values.push(data(value, String(index), label));
  return values;
}

function text(value, label, maximum) {
  if (typeof value !== 'string' || !value || value.length > maximum) fail(`invalid ${label}`);
  return value;
}

function validateSourceUsers(sourceUsers) {
  const users = dataArray(sourceUsers, 'source users', MAX_SOURCE_USERS);
  const sourceIds = new Set();
  for (const user of users) {
    plainDataObject(user, 'source user');
    exactKeys(user, SOURCE_USER_KEYS, 'source user');
    const userId = text(data(user, 'userId', 'source user'), 'source user ID', MAX_SOURCE_ID_LENGTH);
    text(data(user, 'displayName', 'source user'), 'source display name', MAX_DISPLAY_NAME_LENGTH);
    const entryCount = data(user, 'entryCount', 'source user');
    if (!Number.isSafeInteger(entryCount) || entryCount < 1) fail('invalid source entry count');
    if (sourceIds.has(userId)) fail('duplicate source user ID');
    sourceIds.add(userId);
  }
  return { users, sourceIds };
}

function validateMappings(mappings, sourceIds) {
  const values = dataArray(mappings, 'mappings', MAX_SOURCE_USERS);
  const bySourceId = new Map();
  const githubIds = new Set();
  const githubLogins = new Set();
  for (const mapping of values) {
    plainDataObject(mapping, 'mapping');
    const sourceUserId = text(data(mapping, 'sourceUserId', 'mapping'), 'source user ID', MAX_SOURCE_ID_LENGTH);
    if (!sourceIds.has(sourceUserId)) fail('unknown source user ID');
    if (bySourceId.has(sourceUserId)) fail('duplicate source user ID mapping');

    if (Object.hasOwn(mapping, 'skipped')) {
      exactKeys(mapping, SKIP_MAPPING_KEYS, 'mapping');
      if (data(mapping, 'skipped', 'mapping') !== true) fail('skip decision must be true');
      bySourceId.set(sourceUserId, { sourceUserId, skipped: true });
      continue;
    }

    exactKeys(mapping, GITHUB_MAPPING_KEYS, 'mapping');
    const githubUser = data(mapping, 'githubUser', 'mapping');
    plainDataObject(githubUser, 'GitHub user');
    exactKeys(githubUser, GITHUB_USER_KEYS, 'GitHub user');
    const id = data(githubUser, 'id', 'GitHub user');
    const login = data(githubUser, 'login', 'GitHub user');
    if (!Number.isSafeInteger(id) || id <= 0) fail('invalid GitHub user ID');
    if (typeof login !== 'string' || !LOGIN_RE.test(login)) fail('invalid GitHub login');
    const normalizedLogin = login.toLowerCase();
    if (githubIds.has(id)) fail('duplicate GitHub user ID');
    if (githubLogins.has(normalizedLogin)) fail('duplicate GitHub login');
    githubIds.add(id);
    githubLogins.add(normalizedLogin);
    bySourceId.set(sourceUserId, { sourceUserId, githubUser: { id, login } });
  }
  return bySourceId;
}

export function validateClockifyUserMapping(sourceUsers, mappings) {
  const { users, sourceIds } = validateSourceUsers(sourceUsers);
  const bySourceId = validateMappings(mappings, sourceIds);
  if (bySourceId.size !== users.length) fail('missing source user mapping');
  return users.map(user => bySourceId.get(data(user, 'userId', 'source user')));
}
