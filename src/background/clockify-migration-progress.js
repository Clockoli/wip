export const CLOCKIFY_MIGRATION_PROGRESS_PORT = 'CLOCKIFY_MIGRATION_PROGRESS_V1';

export function isClockifyProgressRequestId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function emitClockifyMigrationProgress(ports, requestId, progress) {
  const port = ports.get(requestId);
  if (!port || !progress || typeof progress !== 'object') return;
  const { stage, completed, total, elapsedMs } = progress;
  if (typeof stage !== 'string' || !Number.isSafeInteger(completed) || !Number.isSafeInteger(total)
      || completed < 0 || total < completed) return;
  try {
    port.postMessage({
      type: 'CLOCKIFY_MIGRATION_PROGRESS',
      phase: stage,
      completedUsers: completed,
      totalUsers: total,
      ...(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0 ? { elapsedMs } : {}),
    });
  } catch {
    if (ports.get(requestId) === port) ports.delete(requestId);
  }
}

export function registerClockifyMigrationProgressPort(runtime, ports) {
  runtime.onConnect.addListener(port => {
    const previewUrl = runtime.getURL('src/clockify-migration/preview.html');
    if (port.name !== CLOCKIFY_MIGRATION_PROGRESS_PORT || port.sender?.id !== runtime.id || port.sender?.url !== previewUrl) {
      port.disconnect(); return;
    }
    let requestId = null;
    port.onMessage.addListener(message => {
      if (requestId || !message || typeof message !== 'object' || Array.isArray(message)
          || Object.keys(message).length !== 2 || message.type !== 'SUBSCRIBE_CLOCKIFY_MIGRATION_PROGRESS'
          || !isClockifyProgressRequestId(message.requestId)) { port.disconnect(); return; }
      requestId = message.requestId;
      ports.set(requestId, port);
      try {
        port.postMessage({ type: 'CLOCKIFY_MIGRATION_PROGRESS_SUBSCRIBED' });
      } catch {
        if (ports.get(requestId) === port) ports.delete(requestId);
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => { if (requestId && ports.get(requestId) === port) ports.delete(requestId); });
  });
}
