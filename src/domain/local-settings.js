const CLIENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_CODE_RE = /^[A-Za-z]{2,12}$/;
const CURRENCY_SYMBOL_RE = /^\p{Sc}$/u;
const MAX_RATE_MINOR = 100_000_000;
const MAX_PROJECTS = 50;
const MAX_PROJECT_NAME = 80;
const MAX_PROJECT_SUBSTRINGS = 100;
const MAX_PROJECT_SUBSTRING = 500;
const MAX_TOTAL_PROJECT_SUBSTRINGS = 200;
const MAX_TOTAL_PROJECT_SUBSTRING_LENGTH = 100_000;
const MAX_PROJECTS_UTF8_BYTES = 120_000;
const PROJECT_ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,79})$/;
const DESTINATION_ID_RE = /^github:([1-9]\d*)$/;
const MAX_REPOSITORY_PART = 255;
export const OTHER_PROJECT = 'Other';

export function normalizeOtherProjectName(value = OTHER_PROJECT) {
  const name = String(value ?? '').trim();
  if (!name || name.length > MAX_PROJECT_NAME || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Main project must have a valid name');
  return name;
}

export function normalizeOtherProjectClient(value = '') {
  if (typeof value !== 'string' || (value !== '' && !CLIENT_ID_RE.test(value))) throw new Error('Invalid project client id');
  return value;
}

export function normalizeReportingUtc(value = false) {
  if (typeof value !== 'boolean') throw new Error('UTC reporting setting must be true or false');
  return value;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value, label, maximum = MAX_REPOSITORY_PART) {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} must be a valid non-empty string`);
  return value;
}

export function destinationIdForRepoId(repoId) {
  if (!Number.isSafeInteger(repoId) || repoId <= 0) throw new Error('GitHub repository ID must be a positive safe integer');
  return `github:${repoId}`;
}

export const destinationIdFromRepoId = destinationIdForRepoId;

export function normalizeDestinationId(value) {
  if (typeof value !== 'string') throw new Error('Destination ID must identify a positive GitHub repository ID');
  const match = value.match(DESTINATION_ID_RE);
  if (!match || destinationIdForRepoId(Number(match[1])) !== value) throw new Error('Destination ID must identify a positive GitHub repository ID');
  return value;
}

const DESTINATION_RUNTIME_FIELDS = new Set([
  'repoId', 'owner', 'repo', 'branch', 'ownerType', 'defaultBranch', 'branchMode',
  'storageBranchVersion', 'installationId', 'visibility', 'repositoryFormatVersion',
  'storageLogin', 'recentDays', 'authMode', 'allowedIssueOwners',
]);

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function normalizeDestination(rawId, raw, { referencesOnly = false } = {}) {
  const id = normalizeDestinationId(rawId);
  if (!plainObject(raw)) throw new Error(`Destination ${id} has unexpected fields`);
  const keys = Object.keys(raw);
  const referenceKeys = 'branch,owner,repo,repoId';
  if ((referencesOnly && keys.sort().join(',') !== referenceKeys)
      || (!referencesOnly && keys.some(key => !DESTINATION_RUNTIME_FIELDS.has(key)))) {
    throw new Error(`Destination ${id} has unexpected fields`);
  }
  if (destinationIdForRepoId(raw.repoId) !== id) throw new Error(`Destination ID ${id} does not match its GitHub repository ID`);
  const destination = {
    repoId: raw.repoId,
    owner: boundedText(raw.owner, `Destination ${id} owner`, 100),
    repo: boundedText(raw.repo, `Destination ${id} repository`, 100),
    branch: boundedText(raw.branch, `Destination ${id} branch`),
  };
  if (referencesOnly) return destination;
  if ('ownerType' in raw) destination.ownerType = boundedText(raw.ownerType, `Destination ${id} owner type`, 50);
  if ('defaultBranch' in raw) destination.defaultBranch = boundedText(raw.defaultBranch, `Destination ${id} default branch`);
  if ('branchMode' in raw) {
    if (!['default', 'custom'].includes(raw.branchMode)) throw new Error(`Destination ${id} branch mode is invalid`);
    destination.branchMode = raw.branchMode;
  }
  for (const field of ['storageBranchVersion', 'installationId', 'repositoryFormatVersion']) {
    if (field in raw) destination[field] = positiveInteger(raw[field], `Destination ${id} ${field}`);
  }
  if ('visibility' in raw) {
    if (raw.visibility !== 'private') throw new Error(`Destination ${id} visibility must be private`);
    destination.visibility = raw.visibility;
  }
  if ('storageLogin' in raw) {
    if (!LOGIN_RE.test(raw.storageLogin)) throw new Error(`Destination ${id} storage login is invalid`);
    destination.storageLogin = raw.storageLogin;
  }
  if ('recentDays' in raw) {
    if (!Number.isInteger(raw.recentDays) || raw.recentDays < 1 || raw.recentDays > 31) throw new Error(`Destination ${id} recent entries setting is invalid`);
    destination.recentDays = raw.recentDays;
  }
  if ('authMode' in raw) {
    if (!['github_app', 'pat'].includes(raw.authMode)) throw new Error(`Destination ${id} authentication mode is invalid`);
    destination.authMode = raw.authMode;
  }
  if ('allowedIssueOwners' in raw) {
    if (!Array.isArray(raw.allowedIssueOwners) || raw.allowedIssueOwners.some(owner => !LOGIN_RE.test(owner))) throw new Error(`Destination ${id} allowed issue owners are invalid`);
    destination.allowedIssueOwners = [...raw.allowedIssueOwners];
  }
  return destination;
}

export function normalizeDestinationRegistry(value = {}) {
  if (!plainObject(value)) throw new Error('Destinations must be an object keyed by destination ID');
  return Object.fromEntries(Object.entries(value).map(([id, destination]) => [id, normalizeDestination(id, destination)]));
}

export function normalizeDestinationReferences(value = {}, { strict = false } = {}) {
  if (!plainObject(value)) throw new Error('Destinations must be an object keyed by destination ID');
  return Object.fromEntries(Object.entries(value).map(([id, destination]) => {
    const normalized = normalizeDestination(id, destination, { referencesOnly: strict });
    return [id, {
      repoId: normalized.repoId,
      owner: normalized.owner,
      repo: normalized.repo,
      branch: normalized.branch,
    }];
  }));
}

export const normalizeDestinations = normalizeDestinationRegistry;

export function normalizeDefaultDestinationId(value, destinations = {}) {
  const normalizedDestinations = normalizeDestinationRegistry(destinations);
  if (value === null || value === undefined || value === '') {
    if (Object.keys(normalizedDestinations).length) throw new Error('Default destination must reference a configured destination');
    return null;
  }
  const id = normalizeDestinationId(value);
  if (!Object.hasOwn(normalizedDestinations, id)) throw new Error('Default destination must reference a configured destination');
  return id;
}

function normalizeProjectList(value, destinations, requireRouting) {
  if (!Array.isArray(value)) throw new Error('Projects must be a list');
  if (value.length > MAX_PROJECTS) throw new Error(`Projects cannot contain more than ${MAX_PROJECTS} entries`);
  const normalizedDestinations = destinations === undefined ? null : normalizeDestinationRegistry(destinations);
  const ids = new Set(), names = new Set();
  let totalSubstrings = 0, totalSubstringLength = 0;
  const projects = value.map((raw, index) => {
    if (!plainObject(raw)) throw new Error(`Project ${index + 1} has unexpected fields`);
    const routed = Object.hasOwn(raw, 'id') || Object.hasOwn(raw, 'destinationId');
    const expectedKeys = routed ? ['client,destinationId,id,name,substrings', 'destinationId,id,name,substrings'] : ['client,name,substrings', 'name,substrings'];
    if (!expectedKeys.includes(Object.keys(raw).sort().join(',')) || (requireRouting && !routed)) throw new Error(`Project ${index + 1} has unexpected fields`);
    const name = String(raw.name ?? '').trim();
    if (!name || name.length > MAX_PROJECT_NAME || /[\u0000-\u001f\u007f]/.test(name)) throw new Error(`Project ${index + 1} must have a valid name`);
    const foldedName = name.toLowerCase();
    if (names.has(foldedName)) throw new Error(`Duplicate project name: ${name}`);
    names.add(foldedName);
    let id, destinationId;
    if (routed) {
      id = String(raw.id ?? '');
      if (!PROJECT_ID_RE.test(id)) throw new Error(`Project ${name} must have a valid project ID`);
      if (ids.has(id)) throw new Error(`Duplicate project ID: ${id}`);
      ids.add(id);
      destinationId = normalizeDestinationId(raw.destinationId);
      if (normalizedDestinations && !Object.hasOwn(normalizedDestinations, destinationId)) throw new Error(`Project ${name} references a missing destination`);
    }
    if (!Array.isArray(raw.substrings) || !raw.substrings.length || raw.substrings.length > MAX_PROJECT_SUBSTRINGS) throw new Error(`Project ${name} must have at least one substring`);
    const substrings = [...new Set(raw.substrings.map(item => String(item ?? '').trim().toLowerCase()))];
    if (substrings.some(item => !item || item.length > MAX_PROJECT_SUBSTRING || /[\u0000-\u001f\u007f]/.test(item))) throw new Error(`Project ${name} has an invalid substring`);
    totalSubstrings += substrings.length;
    totalSubstringLength += substrings.reduce((total, substring) => total + substring.length, 0);
    const client = Object.hasOwn(raw, 'client') ? normalizeOtherProjectClient(raw.client) : '';
    return routed ? { id, name, substrings, destinationId, ...(Object.hasOwn(raw, 'client') ? { client } : {}) }
      : { name, substrings, client };
  });
  if (totalSubstrings > MAX_TOTAL_PROJECT_SUBSTRINGS || totalSubstringLength > MAX_TOTAL_PROJECT_SUBSTRING_LENGTH) throw new Error('Project substring list is too large');
  if (new TextEncoder().encode(JSON.stringify(projects)).byteLength > MAX_PROJECTS_UTF8_BYTES) throw new Error('Project substring list is too large');
  return projects;
}

export function normalizeProjects(value = []) {
  return normalizeProjectList(value, undefined, false);
}

export function normalizeProjectDefinitions(value = [], destinations = {}) {
  return normalizeProjectList(value, destinations, true);
}

export function projectNameForUrl(url, projects = [], otherProjectName = OTHER_PROJECT) {
  const candidate = String(url ?? '').toLowerCase();
  for (const project of projects ?? []) {
    if ((project.substrings ?? []).some(substring => candidate.includes(String(substring).toLowerCase()))) return project.name;
  }
  return normalizeOtherProjectName(otherProjectName);
}

export function resolveDestinationIdForUrl(url, projects = [], defaultDestinationId) {
  const candidate = String(url ?? '').toLowerCase();
  for (const project of projects ?? []) {
    if ((project.substrings ?? []).some(substring => candidate.includes(String(substring).toLowerCase()))) return normalizeDestinationId(project.destinationId);
  }
  return normalizeDestinationId(defaultDestinationId);
}

export const destinationIdForUrl = resolveDestinationIdForUrl;

function validDate(value, label) {
  if (value === '') return '';
  const match = typeof value === 'string' ? value.match(DATE_RE) : null;
  if (!match) throw new Error(`${label} must use YYYY-MM-DD`);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new Error(`Invalid ${label.toLowerCase()}`);
  return value;
}

function normalizeCurrency(value) {
  const currency = String(value ?? '').trim();
  if (CURRENCY_SYMBOL_RE.test(currency)) return currency;
  if (CURRENCY_CODE_RE.test(currency)) return currency.toUpperCase();
  throw new Error('Rate currency must be one currency sign or a 2–12 letter description');
}

const EXCHANGE_CURRENCY_ALIASES = Object.freeze({ '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' });

export function exchangeCurrencyCode(value) {
  const currency = normalizeCurrency(value);
  if (EXCHANGE_CURRENCY_ALIASES[currency]) return EXCHANGE_CURRENCY_ALIASES[currency];
  if (/^[A-Z]{3}$/.test(currency)) return currency;
  throw new Error(`${currency} is not supported for exchange-rate conversion. Use a three-letter ISO currency code.`);
}

function defaultCurrencyPosition(currency) {
  return CURRENCY_SYMBOL_RE.test(currency) ? 'prefix' : 'suffix';
}

function normalizeCurrencyPosition(value, currency) {
  if (value === undefined || value === '') return defaultCurrencyPosition(currency);
  if (value !== 'prefix' && value !== 'suffix') throw new Error('Rate currency position must be prefix or suffix');
  return value;
}

function normalizeRatePeriod(raw, login, legacyCurrency = 'USD') {
  const source = plainObject(raw) ? raw : { amountMinorPerHour: raw, startDate: '', endDate: '' };
  const allowed = new Set(['amountMinorPerHour', 'currency', 'currencyPosition', 'startDate', 'endDate']);
  if (Object.keys(source).some(key => !allowed.has(key))) throw new Error(`Unexpected rate period field for ${login}`);
  const amountMinorPerHour = Number(source.amountMinorPerHour);
  if (!Number.isSafeInteger(amountMinorPerHour) || amountMinorPerHour < 0 || amountMinorPerHour > MAX_RATE_MINOR) throw new Error(`Invalid hourly rate for ${login}`);
  const currency = normalizeCurrency(source.currency ?? legacyCurrency);
  const currencyPosition = normalizeCurrencyPosition(source.currencyPosition, currency);
  const startDate = validDate(source.startDate ?? '', `Rate start date for ${login}`);
  const endDate = validDate(source.endDate ?? '', `Rate end date for ${login}`);
  if (startDate && endDate && endDate < startDate) throw new Error(`Rate end date for ${login} must not precede its start date`);
  return { amountMinorPerHour, currency, currencyPosition, startDate, endDate };
}

function normalizeRatePeriods(raw, login, legacyCurrency = 'USD') {
  const periods = (Array.isArray(raw) ? raw : [raw]).map(item => normalizeRatePeriod(item, login, legacyCurrency))
    .sort((left, right) => (left.startDate || '0000-00-00').localeCompare(right.startDate || '0000-00-00') || (left.endDate || '9999-99-99').localeCompare(right.endDate || '9999-99-99'));
  if (!periods.length) throw new Error(`Add at least one rate period for ${login}`);
  for (let index = 1; index < periods.length; index += 1) {
    const previous = periods[index - 1], current = periods[index];
    const currentStart = current.startDate || '0000-00-00';
    if (!previous.endDate && current.startDate && current.startDate > (previous.startDate || '0000-00-00')) {
      const boundary = new Date(`${current.startDate}T00:00:00Z`);
      boundary.setUTCDate(boundary.getUTCDate() - 1);
      previous.endDate = boundary.toISOString().slice(0, 10);
    }
    const previousEnd = previous.endDate || '9999-99-99';
    if (currentStart <= previousEnd) throw new Error(`Rate periods for ${login} overlap`);
  }
  return periods;
}

function invoicingText(value, label, limit, multiline = false) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(multiline ? value.replace(/\n/g, '') : value) || value.trim().length > limit) throw new Error(`Invalid invoicing ${label}`);
  return value.trim();
}

function invoicingParty(value, client = false) {
  const allowed = ['name', 'address', 'email', 'taxId', ...(client ? ['id', 'defaultCurrency'] : [])];
  if (!plainObject(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invoicing party has unexpected fields');
  // The address is captured in a textarea and rendered with white-space:pre-line, so it keeps its line breaks.
  return Object.fromEntries(['name', 'address', 'email', 'taxId'].map(key => [key, invoicingText(value[key] ?? '', key, key === 'address' ? 1000 : 200, key === 'address')]));
}

export function normalizeInvoicingSettings(value = {}) {
  const allowed = ['seller', 'clients', 'nextNumber', 'numberFormat', 'paymentTermsDays', 'paymentTerms', 'taxPercent', 'notes'];
  if (!plainObject(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invoicing settings have unexpected fields');
  const seller = invoicingParty(value.seller ?? {}), source = value.clients ?? [];
  if (!Array.isArray(source) || source.length > 50) throw new Error('Invoicing clients must be a list of at most 50 entries');
  const ids = new Set();
  const clients = source.map(raw => {
    const party = invoicingParty(plainObject(raw) ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'projects')) : raw, true), id = invoicingText(raw.id ?? '', 'client id', 64);
    if (!CLIENT_ID_RE.test(id)) throw new Error('Invalid invoicing client id');
    if (ids.has(id)) throw new Error(`Duplicate invoicing client id: ${id}`);
    ids.add(id);
    const currency = invoicingText(raw.defaultCurrency ?? '', 'client currency', 200);
    return { id, ...party, defaultCurrency: currency ? normalizeCurrency(currency) : '' };
  });
  const nextNumber = value.nextNumber ?? 1, taxPercent = value.taxPercent ?? 0;
  if (!Number.isSafeInteger(nextNumber) || nextNumber < 1 || nextNumber > 1e9) throw new Error('Invoice next number must be a positive integer no greater than 1000000000');
  if (typeof taxPercent !== 'number' || !Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100 || !/^\d+(?:\.\d{1,2})?$/.test(String(taxPercent))) throw new Error('Invoice tax percent must be 0–100 with at most two decimal places');
  const numberFormat = invoicingText(value.numberFormat ?? 'INV-{YYYY}-{NNNN}', 'number format', 64);
  if (!numberFormat.includes('{NNNN}') || /[{}]/.test(numberFormat.replace(/\{(?:YYYY|MM|NNNN)\}/g, ''))) throw new Error('Invoice number format must contain {NNNN} and only {YYYY}, {MM}, {NNNN} tokens');
  const legacyTerms = typeof value.paymentTerms === 'string' ? value.paymentTerms : '';
  const onReceipt = /^(?:due\s+)?on\s+receipt$/i.test(legacyTerms.trim()), numbers = legacyTerms.match(/-?\d+/g) || [];
  const legacyDays = onReceipt ? 0 : Number(legacyTerms.match(/\bnet\s*(-?\d+)/i)?.[1] ?? (numbers.length === 1 ? numbers[0] : 30));
  const paymentTermsDays = Object.hasOwn(value, 'paymentTermsDays') ? value.paymentTermsDays : Math.max(0, Math.min(365, legacyDays));
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365) throw new Error('Invoice payment terms must be an integer from 0 to 365 days');
  let notes = invoicingText(value.notes ?? '', 'notes', 1000, true);
  if (legacyTerms.trim() && legacyTerms !== `Net ${paymentTermsDays}` && !onReceipt) {
    const line = `Payment terms: ${legacyTerms}`, appended = notes ? `${notes}\n${line}` : line;
    if (!notes.split('\n').includes(line) && appended.length <= 1000) notes = invoicingText(appended, 'notes', 1000, true);
  }
  return { seller, clients, nextNumber, numberFormat, paymentTermsDays, taxPercent, notes };
}

export function invoicingSettings(billing = {}) { return normalizeInvoicingSettings(billing?.invoicing ?? {}); }

export function clientForProject(projectName, invoicing, { projects = [], otherProjectName = OTHER_PROJECT, otherProjectClient = '' }) {
  const foldedName = String(projectName ?? '').trim().toLowerCase();
  if (!foldedName) return null;
  const id = foldedName === String(otherProjectName).trim().toLowerCase() ? otherProjectClient
    : projects.find(project => String(project.name).trim().toLowerCase() === foldedName)?.client;
  return id ? (invoicing?.clients ?? []).find(client => client.id === id) ?? null : null;
}

export function projectClientPreferences({ projects = [], billing = {}, otherProjectName = OTHER_PROJECT, otherProjectClient } = {}) {
  const normalized = normalizeProjects(projects);
  let mainClient = normalizeOtherProjectClient(otherProjectClient);
  const clients = billing.invoicing?.clients ?? [];
  // Explicit project links are authoritative; legacy lists are projected without changing their source.
  if (!projects.some(project => Object.hasOwn(project, 'client')) && clients.some(client => Array.isArray(client.projects) && client.projects.length)) {
    for (const client of clients) {
      for (const name of Array.isArray(client.projects) ? client.projects : []) {
        const foldedName = String(name).trim().toLowerCase();
        const id = normalizeOtherProjectClient(String(client.id).trim());
        if (foldedName === otherProjectName.toLowerCase() && otherProjectClient === undefined) mainClient = id;
        const project = normalized.find(project => project.name.toLowerCase() === foldedName);
        if (project) project.client = id;
      }
    }
  }
  return { projects: normalized, otherProjectClient: mainClient };
}

export function formatInvoiceNumber(numberFormat, sequence, issueDate) {
  const settings = normalizeInvoicingSettings({ numberFormat, nextNumber: sequence });
  if (!issueDate) throw new Error('Invoice issue date must use YYYY-MM-DD');
  validDate(issueDate, 'Invoice issue date');
  const tokens = { YYYY: issueDate.slice(0, 4), MM: issueDate.slice(5, 7), NNNN: String(settings.nextNumber).padStart(4, '0') };
  return settings.numberFormat.replace(/\{(YYYY|MM|NNNN)\}/g, (_, token) => tokens[token]);
}

export function normalizeBillingSettings(value = {}) {
  if (!plainObject(value)) throw new Error('Billing settings must be an object');
  const allowed = new Set(['currency', 'rates', 'invoicing']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('Billing settings have unexpected fields');
  const legacyCurrency = normalizeCurrency(value.currency ?? 'USD');
  const source = value.rates ?? {};
  if (!plainObject(source)) throw new Error('Billable rates must be an object');
  const rates = {};
  for (const [login, rawPeriods] of Object.entries(source)) {
    if (!LOGIN_RE.test(login)) throw new Error(`Invalid GitHub login in billable rates: ${login}`);
    const duplicate = Object.keys(rates).find(key => key.toLowerCase() === login.toLowerCase());
    if (duplicate) throw new Error(`Duplicate GitHub login in billable rates: ${login}`);
    rates[login] = normalizeRatePeriods(rawPeriods, login, legacyCurrency);
  }
  return { rates: Object.fromEntries(Object.entries(rates).sort(([a], [b]) => a.localeCompare(b))), ...(Object.hasOwn(value, 'invoicing') ? { invoicing: normalizeInvoicingSettings(value.invoicing) } : {}) };
}

export function rateMajorToMinor(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(text)) throw new Error('Hourly rate must be a non-negative amount with at most two decimal places');
  const [whole, fraction = ''] = text.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor > MAX_RATE_MINOR) throw new Error('Hourly rate is too large');
  return minor;
}

export function rateMinorToMajor(value) {
  const minor = Number(value);
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > MAX_RATE_MINOR) throw new Error('Invalid hourly rate');
  return (minor / 100).toFixed(2);
}

export function parseRateFields(amount, currency) {
  const normalizedCurrency = normalizeCurrency(currency);
  return {
    amountMinorPerHour: rateMajorToMinor(amount),
    currency: normalizedCurrency,
    currencyPosition: defaultCurrencyPosition(normalizedCurrency),
  };
}

export function formatRateInput(rate) {
  const normalized = normalizeRatePeriod(rate, 'rate');
  const amount = rateMinorToMajor(normalized.amountMinorPerHour);
  const separator = CURRENCY_SYMBOL_RE.test(normalized.currency) ? '' : ' ';
  return normalized.currencyPosition === 'prefix'
    ? `${normalized.currency}${separator}${amount}`
    : `${amount}${separator}${normalized.currency}`;
}

export function rateForUser(user, rates = {}, date = '') {
  const normalizedUser = String(user || '').toLowerCase();
  if (!normalizedUser || !plainObject(rates)) return null;
  const key = Object.keys(rates).find(login => login.toLowerCase() === normalizedUser);
  if (!key) return null;
  const raw = rates[key];
  let periods;
  try { periods = normalizeRatePeriods(raw, key); } catch { return null; }
  if (!date) return periods.at(-1) ?? null;
  if (!DATE_RE.test(date)) return null;
  return periods.find(item => (!item.startDate || item.startDate <= date) && (!item.endDate || item.endDate >= date)) ?? null;
}

export function rateMinorForUser(user, rates = {}, date = '') {
  return rateForUser(user, rates, date)?.amountMinorPerHour ?? null;
}

export function billableMinorForRecord(record, rates = {}, date = String(record?.entryDate || record?.startedAt || '').slice(0, 10)) {
  const rate = rateForUser(record?.user, rates, date);
  if (!rate) return 0;
  const seconds = Math.max(0, Number(record?.durationSeconds) || 0);
  return rate.amountMinorPerHour * seconds / 3600;
}

export function billableTotalsByCurrency(records, rates = {}) {
  const totals = new Map();
  for (const record of records ?? []) {
    const date = String(record?.entryDate || record?.startedAt || '').slice(0, 10);
    const rate = rateForUser(record?.user, rates, date);
    if (!rate) continue;
    const current = totals.get(rate.currency) ?? { currency: rate.currency, currencyPosition: rate.currencyPosition, amountMinor: 0 };
    current.amountMinor += billableMinorForRecord(record, rates);
    totals.set(rate.currency, current);
  }
  return [...totals.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

export function billableMinorTotal(records, rates = {}) {
  const totals = billableTotalsByCurrency(records, rates);
  if (totals.length > 1) throw new Error('Billable totals in different currencies cannot be combined');
  return totals[0]?.amountMinor ?? 0;
}

function legacyRepositoryReferenceFromConfig(config) {
  if (!config?.owner || !config?.repo || !config?.branch) return null;
  return {
    owner: String(config.owner),
    repo: String(config.repo),
    branch: String(config.branch),
    ...(Number.isSafeInteger(config.repoId) && config.repoId > 0 ? { repoId: config.repoId } : {}),
  };
}

function destinationReferenceFromConfig(config) {
  const repository = legacyRepositoryReferenceFromConfig(config);
  return repository?.repoId ? repository : null;
}

function routeLegacyProjects(projects, destinationId) {
  return projects.map((project, index) => Object.hasOwn(project, 'id') ? project : {
    id: `legacy-project-${index + 1}`,
    name: project.name,
    substrings: project.substrings,
    destinationId,
  });
}

export function settingsExportText({
  config = null, billing = {}, projects = [], otherProjectName = OTHER_PROJECT, otherProjectClient, reportingUtc = false,
  showQueueDiagnostics = false, destinations, defaultDestinationId,
  exportedAt = new Date().toISOString(),
} = {}) {
  const normalizedBilling = normalizeBillingSettings(billing);
  const rawProjects = projects;
  const normalizedOtherProjectName = normalizeOtherProjectName(otherProjectName);
  const { projects: normalizedProjects, otherProjectClient: normalizedOtherProjectClient } = projectClientPreferences({ projects: rawProjects, billing, otherProjectName: normalizedOtherProjectName, otherProjectClient });
  if (normalizedProjects.some(project => project.name.toLowerCase() === normalizedOtherProjectName.toLowerCase())) throw new Error('Main project name must differ from named projects');
  const recentDays = Number(config?.recentDays ?? 7);
  if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 31) throw new Error('Invalid recent-entry setting');

  const hasRouting = destinations !== undefined || defaultDestinationId !== undefined
    || normalizedProjects.some(project => Object.hasOwn(project, 'id'));
  if (!hasRouting) {
    return `${JSON.stringify({
      format: 'clockoli-settings', version: 7, exportedAt,
      display: { recentDays, reportingUtc: normalizeReportingUtc(reportingUtc), otherProjectClient: normalizedOtherProjectClient, otherProjectName: normalizedOtherProjectName, showQueueDiagnostics: showQueueDiagnostics === true },
      projects: normalizedProjects,
      billing: { invoicing: invoicingSettings(normalizedBilling), rates: normalizedBilling.rates },
      repository: legacyRepositoryReferenceFromConfig(config),
      security: { credentialsIncluded: false },
    }, null, 2)}\n`;
  }

  let runtimeDestinations;
  if (destinations === undefined) {
    const repository = destinationReferenceFromConfig(config);
    runtimeDestinations = repository ? { [destinationIdForRepoId(repository.repoId)]: repository } : {};
  } else {
    runtimeDestinations = normalizeDestinationRegistry(destinations);
  }
  const destinationReferences = normalizeDestinationReferences(runtimeDestinations);
  const destinationIds = Object.keys(destinationReferences);
  const resolvedDefaultDestinationId = normalizeDefaultDestinationId(
    defaultDestinationId ?? (destinationIds.length === 1 ? destinationIds[0] : null),
    destinationReferences,
  );
  if (normalizedProjects.some(project => !Object.hasOwn(project, 'id')) && !resolvedDefaultDestinationId) {
    throw new Error('Projects require a default destination before they can be exported');
  }
  const routedProjects = normalizeProjectDefinitions(
    routeLegacyProjects(normalizedProjects, resolvedDefaultDestinationId),
    destinationReferences,
  );
  return `${JSON.stringify({
    format: 'clockoli-settings', version: 6, exportedAt,
    display: { recentDays, otherProjectName: normalizedOtherProjectName, showQueueDiagnostics: showQueueDiagnostics === true },
    projects: routedProjects,
    billing: normalizedBilling,
    destinations: destinationReferences,
    defaultDestinationId: resolvedDefaultDestinationId,
    security: { credentialsIncluded: false },
  }, null, 2)}\n`;
}

function validateLegacyRepositoryReference(repository) {
  if (repository === null) return null;
  if (!plainObject(repository)) throw new Error('Settings file has invalid repository reference');
  const keys = Object.keys(repository).sort().join(',');
  if (keys !== 'branch,owner,repo' && keys !== 'branch,owner,repo,repoId') throw new Error('Settings file has unexpected repository fields');
  if (typeof repository.owner !== 'string' || typeof repository.repo !== 'string' || typeof repository.branch !== 'string'
      || ('repoId' in repository && (!Number.isSafeInteger(repository.repoId) || repository.repoId <= 0))) throw new Error('Settings file has invalid repository reference');
  return {
    owner: repository.owner,
    repo: repository.repo,
    branch: repository.branch,
    ...(Number.isSafeInteger(repository.repoId) && repository.repoId > 0 ? { repoId: repository.repoId } : {}),
  };
}

function withLegacyImportReferences(imported, references) {
  Object.defineProperties(imported, Object.fromEntries(Object.entries(references).map(([key, value]) => [key, {
    value,
    enumerable: false,
    writable: false,
    configurable: false,
  }])));
  return imported;
}

export function parseSettingsImport(text) {
  let value;
  try { value = JSON.parse(String(text)); } catch { throw new Error('Settings file is not valid JSON'); }
  if (!plainObject(value) || value.format !== 'clockoli-settings' || ![1, 2, 3, 4, 5, 6, 7].includes(value.version)) throw new Error('Unsupported Clockoli settings file');
  const routedExport = value.version === 6 && Object.hasOwn(value, 'destinations');
  const expectedKeys = routedExport
    ? ['billing', 'defaultDestinationId', 'destinations', 'display', 'exportedAt', 'format', 'projects', 'security', 'version']
    : value.version >= 3
      ? ['billing', 'display', 'exportedAt', 'format', 'projects', 'repository', 'security', 'version']
      : ['billing', 'display', 'exportedAt', 'format', 'repository', 'security', 'version'];
  if (Object.keys(value).sort().join(',') !== expectedKeys.join(',')) throw new Error('Settings file has unexpected fields');
  const displayKeys = plainObject(value.display) ? Object.keys(value.display).sort().join(',') : '';
  const displayKeySets = value.version >= 7
    ? ['otherProjectClient,otherProjectName,recentDays,reportingUtc,showQueueDiagnostics', 'otherProjectClient,otherProjectName,recentDays,showQueueDiagnostics']
    : value.version === 6 && !routedExport
      ? ['otherProjectClient,otherProjectName,recentDays,reportingUtc,showQueueDiagnostics', 'otherProjectClient,otherProjectName,recentDays,showQueueDiagnostics', 'otherProjectName,recentDays,showQueueDiagnostics']
      : value.version >= 5 ? ['otherProjectName,recentDays,showQueueDiagnostics']
        : value.version === 4 ? ['otherProjectName,recentDays'] : ['recentDays'];
  if (!displayKeySets.includes(displayKeys)) throw new Error('Settings file is missing display settings or has unexpected display fields');
  const billingKeys = plainObject(value.billing) ? Object.keys(value.billing).sort().join(',') : '';
  const billingKeySets = value.version >= 7 || (value.version === 6 && !routedExport)
    ? ['invoicing,rates'] : value.version === 1 ? ['currency,rates'] : ['rates'];
  if (!billingKeySets.includes(billingKeys)) throw new Error('Settings file has unexpected billing fields');
  if (!plainObject(value.security) || Object.keys(value.security).join(',') !== 'credentialsIncluded' || value.security.credentialsIncluded !== false) throw new Error('Settings files must not contain credentials');
  if (typeof value.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.exportedAt)
      || Number.isNaN(Date.parse(value.exportedAt))) throw new Error('Settings file has an invalid export timestamp');
  const recentDays = Number(value.display.recentDays);
  if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 31) throw new Error('Recent entries must be between 1 and 31 days');
  if (value.version >= 5 && typeof value.display.showQueueDiagnostics !== 'boolean') throw new Error('Queue diagnostics setting must be true or false');

  let repository = null, destinations, defaultDestinationId, projects, projectDefinitions;
  if (routedExport) {
    destinations = normalizeDestinationReferences(value.destinations, { strict: true });
    defaultDestinationId = normalizeDefaultDestinationId(value.defaultDestinationId, destinations);
    projects = normalizeProjectDefinitions(value.projects, destinations);
    projectDefinitions = projects;
  } else {
    repository = validateLegacyRepositoryReference(value.repository);
    const hasStableReference = Number.isSafeInteger(repository?.repoId) && repository.repoId > 0;
    destinations = hasStableReference ? { [destinationIdForRepoId(repository.repoId)]: repository } : {};
    defaultDestinationId = hasStableReference ? destinationIdForRepoId(repository.repoId) : null;
    projects = value.version >= 3 ? normalizeProjects(value.projects) : [];
    projectDefinitions = defaultDestinationId
      ? normalizeProjectDefinitions(routeLegacyProjects(projects, defaultDestinationId), destinations)
      : projects;
  }
  const resolvedOtherProjectName = value.version >= 4 ? normalizeOtherProjectName(value.display.otherProjectName) : OTHER_PROJECT;
  const importedSourceProjects = routedExport ? value.projects : (value.version >= 3 ? value.projects : []);
  const hasInvoiceFields = Object.hasOwn(value.billing, 'invoicing');
  const hasClientFields = Object.hasOwn(value.display, 'otherProjectClient') || importedSourceProjects.some(project => Object.hasOwn(project, 'client'))
    || (value.billing.invoicing?.clients ?? []).some(client => Array.isArray(client?.projects));
  const hasReportingUtc = value.version >= 7 || Object.hasOwn(value.display, 'reportingUtc');
  const { projects: importedProjects, otherProjectClient } = projectClientPreferences({
    projects: importedSourceProjects, billing: value.billing, otherProjectName: resolvedOtherProjectName,
    otherProjectClient: Object.hasOwn(value.display, 'otherProjectClient') ? normalizeOtherProjectClient(value.display.otherProjectClient) : undefined,
  });
  const normalizedImportedProjects = hasClientFields ? importedProjects : importedProjects.map(({ client: _client, ...project }) => project);
  if (normalizedImportedProjects.some(project => project.name.toLowerCase() === resolvedOtherProjectName.toLowerCase())) throw new Error('Main project name must differ from named projects');
  const invoiceDefaultsRequired = !routedExport;
  const imported = {
    recentDays, projects: normalizedImportedProjects, otherProjectName: resolvedOtherProjectName,
    ...(hasClientFields ? { otherProjectClient } : {}),
    ...(hasReportingUtc ? { reportingUtc: normalizeReportingUtc(value.display.reportingUtc) } : {}),
    showQueueDiagnostics: value.version >= 5 && value.display.showQueueDiagnostics === true,
    billing: hasInvoiceFields || invoiceDefaultsRequired
      ? { ...normalizeBillingSettings(value.billing), invoicing: invoicingSettings(value.billing) }
      : normalizeBillingSettings(value.billing),
  };
  if (routedExport) return {
    ...imported,
    destinations,
    defaultDestinationId,
    repositoryReferencesVerified: false,
  };
  return withLegacyImportReferences(imported, {
    repository,
    destinations,
    defaultDestinationId,
    projectDefinitions,
    repositoryReferencesVerified: false,
  });
}
