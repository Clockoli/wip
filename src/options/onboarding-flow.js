import { validateOwner, validateRepo } from '../domain/values.js';

export function onboardingStep({ authorized = false } = {}) {
  return authorized ? 2 : 1;
}

// Coordinates are unverified intent, never proof of existence or permission.
export function parseRepositoryTarget(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  let coordinates = input;
  if (input.includes('://')) {
    const url = new URL(input);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
        || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(input)) throw new Error('Enter a GitHub repository URL or owner/name.');
    coordinates = url.pathname.slice(1).replace(/\/$/, '');
  }
  const parts = coordinates.split('/');
  if (parts.length !== 2) throw new Error('Enter a GitHub repository URL or owner/name.');
  return `${validateOwner(parts[0])}/${validateRepo(parts[1])}`;
}

export function selectOnlyEligibleRepository(repositories = []) {
  const eligible = repositories.filter(repository => repository?.eligible === true);
  return eligible.length === 1 ? eligible[0] : null;
}

export function settleBeforeDeadline(promise, timeoutMs, makeError = () => new Error('Operation timed out')) {
  const delay = Math.max(0, Number(timeoutMs) || 0);
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(makeError()), delay);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}
