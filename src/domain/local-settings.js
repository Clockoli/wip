const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_CODE_RE = /^[A-Za-z]{2,12}$/;
const CURRENCY_SYMBOL_RE = /^\p{Sc}$/u;
const RATE_AMOUNT_SOURCE = '(?:0|[1-9]\\d{0,6})(?:\\.\\d{1,2})?';
const RATE_CURRENCY_SOURCE = '(?:\\p{Sc}|[A-Za-z]{2,12})';
const RATE_PREFIX_RE = new RegExp(`^(${RATE_CURRENCY_SOURCE})\\s*(${RATE_AMOUNT_SOURCE})$`, 'u');
const RATE_SUFFIX_RE = new RegExp(`^(${RATE_AMOUNT_SOURCE})\\s*(${RATE_CURRENCY_SOURCE})$`, 'u');
const MAX_RATE_MINOR = 100_000_000;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

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
    const previousEnd = periods[index - 1].endDate || '9999-99-99';
    const currentStart = periods[index].startDate || '0000-00-00';
    if (currentStart <= previousEnd) throw new Error(`Rate periods for ${login} overlap`);
  }
  return periods;
}

export function normalizeBillingSettings(value = {}) {
  if (!plainObject(value)) throw new Error('Billing settings must be an object');
  const allowed = new Set(['currency', 'rates']);
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
  return { rates: Object.fromEntries(Object.entries(rates).sort(([a], [b]) => a.localeCompare(b))) };
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

export function parseRateInput(value) {
  const text = String(value ?? '').trim();
  let match = text.match(RATE_PREFIX_RE), currencyPosition = 'prefix';
  let currency, amount;
  if (match) [, currency, amount] = match;
  else {
    match = text.match(RATE_SUFFIX_RE); currencyPosition = 'suffix';
    if (match) [, amount, currency] = match;
  }
  if (!match) throw new Error('Hourly rate must include an amount and currency, for example $15.50 or 750 RUB');
  currency = normalizeCurrency(currency);
  return { amountMinorPerHour: rateMajorToMinor(amount), currency, currencyPosition };
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

export function billableMinorForRecord(record, rates = {}) {
  const date = String(record?.entryDate || record?.startedAt || '').slice(0, 10);
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

export function settingsExportText({ config = null, billing = {}, exportedAt = new Date().toISOString() } = {}) {
  const normalized = normalizeBillingSettings(billing);
  const repository = config?.owner && config?.repo && config?.branch ? {
    owner: String(config.owner), repo: String(config.repo), branch: String(config.branch),
    ...(Number.isSafeInteger(config.repoId) && config.repoId > 0 ? { repoId: config.repoId } : {}),
  } : null;
  const recentDays = Number(config?.recentDays ?? 7);
  if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 31) throw new Error('Invalid recent-entry setting');
  return `${JSON.stringify({
    format: 'repoclock-settings', version: 2, exportedAt,
    display: { recentDays }, billing: normalized, repository,
    security: { credentialsIncluded: false },
  }, null, 2)}\n`;
}

export function parseSettingsImport(text) {
  let value;
  try { value = JSON.parse(String(text)); } catch { throw new Error('Settings file is not valid JSON'); }
  if (!plainObject(value) || value.format !== 'repoclock-settings' || ![1, 2].includes(value.version)) throw new Error('Unsupported Clockoli settings file');
  const expectedKeys = ['billing', 'display', 'exportedAt', 'format', 'repository', 'security', 'version'];
  if (Object.keys(value).sort().join(',') !== expectedKeys.join(',')) throw new Error('Settings file has unexpected fields');
  if (!plainObject(value.display) || Object.keys(value.display).join(',') !== 'recentDays') throw new Error('Settings file is missing display settings or has unexpected display fields');
  const billingKeys = plainObject(value.billing) ? Object.keys(value.billing).sort().join(',') : '';
  if ((value.version === 1 && billingKeys !== 'currency,rates') || (value.version === 2 && billingKeys !== 'rates')) throw new Error('Settings file has unexpected billing fields');
  if (!plainObject(value.security) || Object.keys(value.security).join(',') !== 'credentialsIncluded' || value.security.credentialsIncluded !== false) throw new Error('Settings files must not contain credentials');
  if (typeof value.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.exportedAt)
      || Number.isNaN(Date.parse(value.exportedAt))) throw new Error('Settings file has an invalid export timestamp');
  if (value.repository !== null) {
    if (!plainObject(value.repository)) throw new Error('Settings file has invalid repository reference');
    const keys = Object.keys(value.repository).sort().join(',');
    if (keys !== 'branch,owner,repo' && keys !== 'branch,owner,repo,repoId') throw new Error('Settings file has unexpected repository fields');
    if (typeof value.repository.owner !== 'string' || typeof value.repository.repo !== 'string' || typeof value.repository.branch !== 'string'
        || ('repoId' in value.repository && (!Number.isSafeInteger(value.repository.repoId) || value.repository.repoId <= 0))) throw new Error('Settings file has invalid repository reference');
  }
  const recentDays = Number(value.display.recentDays);
  if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 31) throw new Error('Recent entries must be between 1 and 31 days');
  return { recentDays, billing: normalizeBillingSettings(value.billing) };
}
