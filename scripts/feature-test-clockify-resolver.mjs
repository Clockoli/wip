#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createClockifyGitHubResolver } from '../src/services/clockify-github-resolver.js';

const [csvPath, issuesPath, modelPath, outputPath] = process.argv.slice(2);
if (![csvPath, issuesPath, modelPath, outputPath].every(Boolean)) throw new Error('usage: feature-test-clockify-resolver.mjs CSV ISSUES_JSON MODEL_JSON OUTPUT_JSON');
const csv = await readFile(csvPath, 'utf8');
const [header, ...lines] = csv.trim().split(/\r?\n/);
const columns = header.split(',');
const rows = lines.map(line => Object.fromEntries(columns.map((key, index) => [key, line.split(',')[index] || ''])));
const issues = JSON.parse(await readFile(issuesPath, 'utf8')).items;
const modelArtifact = JSON.parse(await readFile(modelPath, 'utf8'));
const candidates = issues.map(issue => {
  const [, owner, repository] = issue.repository_url.match(/\/repos\/([^/]+)\/([^/]+)$/) || [];
  return { provider: 'github', organization: owner, repository, entityType: issue.pull_request ? 'pull_request' : 'issue', externalId: String(issue.number), title: issue.title, externalUrl: issue.html_url };
});
const repositories = [...new Map(candidates.map(item => [`${item.organization}/${item.repository}`, `${item.organization}/${item.repository}`])).values()];
const resolver = createClockifyGitHubResolver({ repositories, modelArtifact, discover: async () => candidates.slice(0, 20), validate: async candidate => candidates.find(item => item.organization === candidate.organization && item.repository === candidate.repository && item.externalId === String(candidate.number)) || null });
const results = [];
for (const row of rows) {
  const resolved = await resolver.resolve({ project: row.project, task: row.task.replaceAll('"', ''), description: row.description.replaceAll('"', ''), tags: row.tags ? row.tags.replaceAll('"', '').split(' ') : [] });
  const url = resolved.status === 'unresolved' ? '' : resolved.resolution.externalUrl;
  results.push({ entryId: row.entry_id, difficulty: row.difficulty, status: resolved.status, expectedUrl: row.expected_url, actualUrl: url, correct: url === row.expected_url });
}
await writeFile(outputPath, `${JSON.stringify({ candidates: candidates.length, results }, null, 2)}\n`);
console.log(JSON.stringify({ total: results.length, correct: results.filter(item => item.correct).length, results }, null, 2));
