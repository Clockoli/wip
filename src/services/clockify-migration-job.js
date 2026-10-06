import { CLOCKIFY_MIGRATION_PREVIEW_KEY, MAX_CLOCKIFY_MIGRATION_SESSION_TTL_MS, snapshotStoredClockifyMigrationPreview, snapshotClockifyMigrationData } from './clockify-migration-session.js';
import { snapshotClockifyRequestedMappings } from './clockify-identity-mapping.js';

export const CLOCKIFY_MIGRATION_JOB_KEY = 'clockify-migration-import-job-v1';
const OUTCOME_KEY = 'clockify-migration-import-outcome-v1';
const VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const STATUS = new Set(['imported', 'already_present', 'conflict', 'failed']);

function snapshotPin(value) {
  const keys = Object.keys(value || {}).sort().join(',');
  if (!value || (keys !== 'actorId,authGeneration,branch,defaultBranch,destinationId,login,owner,repo,repoId'
      && keys !== 'actorId,authCandidateId,authGeneration,branch,defaultBranch,destinationId,login,owner,repo,repoId')
      || (value.authCandidateId !== undefined && !UUID.test(value.authCandidateId))
      || !Number.isSafeInteger(value.repoId) || value.repoId <= 0
      || !Number.isSafeInteger(value.actorId) || value.actorId <= 0
      || !Number.isSafeInteger(value.authGeneration) || value.authGeneration < 0
      || value.destinationId !== `github:${value.repoId}` || !LOGIN.test(value.login)
      || !LOGIN.test(value.owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(value.repo)
      || typeof value.branch !== 'string' || !/^clockoli\/users\/[1-9]\d*$/.test(value.branch)
      || value.branch !== `clockoli/users/${value.actorId}`
      || typeof value.defaultBranch !== 'string' || !value.defaultBranch || value.defaultBranch.length > 255) {
    throw new Error('Invalid migration destination identity');
  }
  return { ...value };
}

function snapshotJob(job) {
  if (!job || job.version !== VERSION || !UUID.test(job.id) || !Number.isSafeInteger(job.startedAt)
      || !Array.isArray(job.outcomes) || !Array.isArray(job.mappings)) throw new Error('Stored migration job is invalid');
  const data = snapshotClockifyMigrationData(job.data);
  const mappings = snapshotClockifyRequestedMappings(data.users, job.mappings);
  const pin = snapshotPin(job.pin);
  const selected = mappings.filter(item => !item.skipped);
  if (job.outcomes.length > selected.length || job.outcomes.some((outcome, index) =>
    outcome?.sourceUserId !== selected[index].sourceUserId || !STATUS.has(outcome?.status)
    || !Number.isSafeInteger(outcome?.githubUser?.id) || outcome.githubUser.id <= 0
    || outcome.githubUser?.login?.toLowerCase() !== selected[index].githubLogin.toLowerCase())) {
    throw new Error('Stored migration checkpoint is invalid');
  }
  if (job.retryAt !== null && (typeof job.retryAt !== 'string' || !Number.isFinite(Date.parse(job.retryAt)))) throw new Error('Stored migration retry is invalid');
  if (job.blockedReason != null && job.blockedReason !== 'mapping_unresolved') throw new Error('Stored migration block is invalid');
  return { version: VERSION, id: job.id, startedAt: job.startedAt, data, mappings, pin,
    outcomes: job.outcomes.map(value => ({ ...value, githubUser: { ...value.githubUser } })), retryAt: job.retryAt,
    blockedReason: job.blockedReason ?? null };
}

export function createClockifyMigrationJobService({ backend, now = () => Date.now(), randomUUID = () => crypto.randomUUID() }) {
  if (!backend?.getMany || !backend?.mutateMany) throw new Error('Migration job requires atomic storage');
  return Object.freeze({
    async createPreview(normalized) {
      const current = now();
      const preview = { version: VERSION, id: randomUUID(), expiresAt: current + 60 * 60 * 1000,
        data: snapshotClockifyMigrationData(normalized) };
      snapshotStoredClockifyMigrationPreview(preview, current);
      const saved = await backend.mutateMany([CLOCKIFY_MIGRATION_PREVIEW_KEY, CLOCKIFY_MIGRATION_JOB_KEY], values => {
        if (values[CLOCKIFY_MIGRATION_JOB_KEY]) return null;
        return { set: { [CLOCKIFY_MIGRATION_PREVIEW_KEY]: preview }, result: { id: preview.id, expiresAt: preview.expiresAt } };
      });
      if (!saved) throw new Error('A Clockify migration is already pending. Finish or repair it before capturing another report.');
      return saved;
    },
    async claim(id, mappings, pin) {
      if (!UUID.test(id)) throw new Error('Invalid migration confirmation');
      const validatedPin = snapshotPin(pin);
      const result = await backend.mutateMany([CLOCKIFY_MIGRATION_PREVIEW_KEY, CLOCKIFY_MIGRATION_JOB_KEY], values => {
        if (values[CLOCKIFY_MIGRATION_JOB_KEY]) return null;
        let preview, requested;
        try {
          preview = snapshotStoredClockifyMigrationPreview(values[CLOCKIFY_MIGRATION_PREVIEW_KEY], now());
          if (preview.id !== id) return null;
          requested = snapshotClockifyRequestedMappings(preview.data.users, mappings);
        } catch { return null; }
        const job = { version: VERSION, id, startedAt: now(), data: preview.data, mappings: requested,
          pin: validatedPin, outcomes: [], retryAt: null, blockedReason: null };
        return { delete: [CLOCKIFY_MIGRATION_PREVIEW_KEY, OUTCOME_KEY], set: { [CLOCKIFY_MIGRATION_JOB_KEY]: job }, result: job };
      });
      if (!result) throw new Error('Migration preview is unavailable, or an import is already running.');
      return snapshotJob(result);
    },
    async load() {
      const job = (await backend.getMany([CLOCKIFY_MIGRATION_JOB_KEY]))[CLOCKIFY_MIGRATION_JOB_KEY];
      return job ? snapshotJob(job) : null;
    },
    async checkpoint(id, outcome) {
      const saved = await backend.mutateMany([CLOCKIFY_MIGRATION_JOB_KEY], values => {
        const job = snapshotJob(values[CLOCKIFY_MIGRATION_JOB_KEY]);
        const next = job.mappings.filter(item => !item.skipped)[job.outcomes.length];
        if (job.id !== id || !next || outcome?.sourceUserId !== next.sourceUserId
            || !STATUS.has(outcome.status) || !Number.isSafeInteger(outcome.githubUser?.id) || outcome.githubUser.id <= 0
            || outcome.githubUser?.login?.toLowerCase() !== next.githubLogin.toLowerCase()) return null;
        return { set: { [CLOCKIFY_MIGRATION_JOB_KEY]: { ...job, outcomes: [...job.outcomes, outcome] } } };
      });
      if (!saved) throw new Error('Migration checkpoint rejected');
    },
    async retry(id, retryAt) {
      if (retryAt !== null && (typeof retryAt !== 'string' || !Number.isFinite(Date.parse(retryAt)))) throw new Error('Invalid migration retry deadline');
      const saved = await backend.mutateMany([CLOCKIFY_MIGRATION_JOB_KEY], values => {
        const job = snapshotJob(values[CLOCKIFY_MIGRATION_JOB_KEY]);
        return job.id === id ? { set: { [CLOCKIFY_MIGRATION_JOB_KEY]: { ...job, retryAt } } } : null;
      });
      if (!saved) throw new Error('Migration retry checkpoint rejected');
    },
    async block(id, reason) {
      if (reason !== 'mapping_unresolved') throw new Error('Invalid migration block reason');
      const saved = await backend.mutateMany([CLOCKIFY_MIGRATION_JOB_KEY], values => {
        const job = snapshotJob(values[CLOCKIFY_MIGRATION_JOB_KEY]);
        return job.id === id ? { set: { [CLOCKIFY_MIGRATION_JOB_KEY]: { ...job, blockedReason: reason, retryAt: null } } } : null;
      });
      if (!saved) throw new Error('Migration block rejected');
    },
    async restorePreview(id, { connectionChanged = false } = {}) {
      const previewId = randomUUID();
      const current = now();
      if (!UUID.test(previewId) || !Number.isSafeInteger(current) || current < 0) throw new Error('Invalid restored preview');
      const restored = await backend.mutateMany([CLOCKIFY_MIGRATION_JOB_KEY, CLOCKIFY_MIGRATION_PREVIEW_KEY], values => {
        const job = snapshotJob(values[CLOCKIFY_MIGRATION_JOB_KEY]);
        if (job.id !== id || (job.blockedReason !== 'mapping_unresolved' && connectionChanged !== true)) {
          throw new Error('Migration is not blocked for mapping repair');
        }
        if (values[CLOCKIFY_MIGRATION_PREVIEW_KEY] != null) throw new Error('Another migration preview already exists');
        const preview = { version: 1, id: previewId, expiresAt: current + MAX_CLOCKIFY_MIGRATION_SESSION_TTL_MS, data: job.data };
        snapshotStoredClockifyMigrationPreview(preview, current);
        return { set: { [CLOCKIFY_MIGRATION_PREVIEW_KEY]: preview }, delete: [CLOCKIFY_MIGRATION_JOB_KEY], result: { id: previewId } };
      });
      if (!restored) throw new Error('Migration mapping repair is unavailable');
      return restored;
    },
    async finish(id) {
      const outcome = await backend.mutateMany([CLOCKIFY_MIGRATION_JOB_KEY, OUTCOME_KEY], values => {
        const job = snapshotJob(values[CLOCKIFY_MIGRATION_JOB_KEY]);
        if (job.id !== id || job.outcomes.length !== job.mappings.filter(item => !item.skipped).length) return null;
        const saved = { id, destinationId: job.pin.destinationId, users: job.data.users, outcomes: job.outcomes };
        return { delete: [CLOCKIFY_MIGRATION_JOB_KEY], set: { [OUTCOME_KEY]: saved }, result: saved };
      });
      if (!outcome) throw new Error('Migration is not ready to finish');
      return outcome;
    },
  });
}
