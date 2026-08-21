export function onboardingStep({ authorized = false, discoveryStatus = 'idle', repositories = [] } = {}) {
  if (!authorized) return 1;
  if (discoveryStatus !== 'ready' || repositories.length === 0) return 2;
  return 3;
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
