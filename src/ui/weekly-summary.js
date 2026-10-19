// Pure weekly aggregation of the same visible intervals used by Calendar.
(() => {
  function formatMinutes(minutes) {
    const whole = Math.max(0, Math.floor(minutes));
    const hours = Math.floor(whole / 60);
    const rest = whole % 60;
    return hours ? `${hours}h ${rest}m` : `${rest}m`;
  }
  function summarize(items, start, end, now) {
    if (!Array.isArray(items) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { total: '0m', average: '0m', entries: 0, tasks: 0 };
    }
    const taskUrls = new Set();
    let totalMs = 0, entries = 0;
    for (const item of items) {
      const from = Math.max(start, Number(item.startedAt));
      const to = Math.min(end, item.isRunning ? now : Number(item.endedAt));
      // A newly started running timer is a record even before one millisecond has elapsed.
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || (to === from && !item.isRunning)) continue;
      totalMs += to - from;
      entries++;
      const identity = item.taskIdentity || item.url;
      if (identity) taskUrls.add(identity);
    }
    const minutes = Math.floor(totalMs / 60000);
    return {
      total: formatMinutes(minutes),
      // This is per calendar day (including weekends), not per day with an entry.
      average: formatMinutes(Math.floor(minutes / 7)),
      entries,
      tasks: taskUrls.size,
    };
  }
  globalThis.ClockoliWeeklySummary = Object.freeze({ summarize });
})();
