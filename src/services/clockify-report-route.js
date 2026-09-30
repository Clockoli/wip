export function clockifyDetailedReportYear(urlValue) {
  let url;
  try { url = new URL(urlValue); } catch { throw new Error('Clockify report URL is invalid'); }
  if (url.protocol !== 'https:' || url.hostname !== 'app.clockify.me' || url.pathname.replace(/\/+$/, '') !== '/reports/detailed') {
    throw new Error('Clockify report URL is invalid');
  }
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const startMatch = /^(\d{4})-01-01T00:00:00\.000Z$/.exec(start || '');
  if (!startMatch || end !== `${startMatch[1]}-12-31T23:59:59.999Z`) throw new Error('Clockify report must cover one calendar year');
  return Number(startMatch[1]);
}
