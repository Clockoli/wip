import { exchangeCurrencyCode } from '../domain/local-settings.js';

const CACHE_VERSION = 2;
const CURRENT_DATE_TTL_MS = 12 * 60 * 60 * 1000;

function normalizeCache(value) {
  return value?.version === CACHE_VERSION && value.entries && typeof value.entries === 'object'
    ? { version: CACHE_VERSION, entries: { ...value.entries } }
    : { version: CACHE_VERSION, entries: {} };
}

function cacheKey(target, date, source) { return `${target}|${date}|${source}`; }

function isFresh(entry, date, now) {
  if (!entry || !Number.isFinite(entry.factor) || entry.factor <= 0) return false;
  if (entry.effectiveDate === date) return true;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return true;
  const fetchedAt = Date.parse(entry.fetchedAt || '');
  const fallbackRefreshDeadline = Date.parse(`${date}T00:00:00Z`) + 7 * 24 * 60 * 60 * 1000;
  if (now.getTime() >= fallbackRefreshDeadline) return true;
  return Number.isFinite(fetchedAt) && now.getTime() - fetchedAt < CURRENT_DATE_TTL_MS;
}

function rateOnOrBefore(rates, date) {
  const available = Object.keys(rates).filter(key => key <= date).sort();
  const effectiveDate = available.at(-1);
  return effectiveDate ? { effectiveDate, rates: rates[effectiveDate] } : null;
}

export class ExchangeRateService {
  constructor({ cache = null, fetchImpl = globalThis.fetch, now = () => new Date(), endpoint = 'https://api.frankfurter.dev/v1' } = {}) {
    this.cache = cache;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.endpoint = endpoint;
  }

  async ratesForDates({ targetCurrency, sourceCurrencies = [], dates = [], signal } = {}) {
    const targetCode = exchangeCurrencyCode(targetCurrency);
    const sourceCodes = [...new Set(sourceCurrencies.map(exchangeCurrencyCode))].sort();
    const requiredDates = [...new Set(dates.map(String))].sort();
    if (!requiredDates.length) return { targetCurrency, targetCode, rates: {} };
    const now = this.now(), cache = normalizeCache(await this.cache?.getExchangeRateCache?.());
    const missing = requiredDates.some(date => sourceCodes.some(source => source !== targetCode
      && !isFresh(cache.entries[cacheKey(targetCode, date, source)], date, now)));
    if (missing) {
      const symbols = sourceCodes.filter(source => source !== targetCode);
      if (symbols.length) {
        const range = `${requiredDates[0]}..${requiredDates.at(-1)}`;
        const query = new URLSearchParams({ base: targetCode, symbols: symbols.join(',') });
        const response = await this.fetchImpl(`${this.endpoint}/${range}?${query}`, { headers: { Accept: 'application/json' }, signal });
        if (!response?.ok) throw new Error(`Frankfurter exchange-rate request failed (${response?.status || 'network error'})`);
        const payload = await response.json(), timeline = payload?.rates && typeof payload.rates === 'object' ? payload.rates : {};
        for (const source of symbols) {
          if (!Object.values(timeline).some(day => Number(day?.[source]) > 0)) throw new Error(`${source} exchange rates are not available from Frankfurter.`);
        }
        for (const date of requiredDates) {
          const quote = rateOnOrBefore(timeline, date);
          if (!quote) throw new Error(`Frankfurter has no exchange rate on or before ${date}.`);
          for (const source of symbols) {
            const quoted = Number(quote.rates[source]);
            if (!(quoted > 0)) throw new Error(`${source} exchange rates are not available from Frankfurter on or before ${date}.`);
            cache.entries[cacheKey(targetCode, date, source)] = {
              factor: 1 / quoted, effectiveDate: quote.effectiveDate, fetchedAt: now.toISOString(),
            };
          }
        }
        await this.cache?.saveExchangeRateCache?.(cache);
      }
    }
    const rates = {};
    for (const date of requiredDates) {
      rates[date] = { [targetCode]: 1 };
      for (const source of sourceCodes) {
        if (source === targetCode) continue;
        const entry = cache.entries[cacheKey(targetCode, date, source)];
        if (!isFresh(entry, date, now)) throw new Error(`No cached ${source} to ${targetCode} exchange rate is available for ${date}.`);
        rates[date][source] = entry.factor;
      }
    }
    return { targetCurrency, targetCode, rates };
  }
}
