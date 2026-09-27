import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreClockifyResolverCandidate, validateClockifyResolverModel } from '../src/services/clockify-resolver-model.js';

const model = {
  version: 3,
  modelType: 'catboost-oblivious-trees',
  featureSchemaVersion: 3,
  features: ['issue_id_exact_match', 'repository_exact_match'],
  bias: 0,
  trees: [{
    splits: [{ featureIndex: 0, threshold: 0.5 }, { featureIndex: 1, threshold: 0.5 }],
    leafValues: [-2, -1, 1, 2],
  }],
  training: { catBoostVersion: '1.2.8', datasetVersion: `sha256:${'a'.repeat(64)}` },
  evaluation: { heldOutPrecision: 1, heldOutRecall: 1, groups: 'source_file_sha256+user' },
};

test('evaluates an exported CatBoost oblivious-tree artifact with its declared feature order', () => {
  assert.deepEqual(validateClockifyResolverModel(model), model);
  assert.equal(scoreClockifyResolverCandidate(model, { issue_id_exact_match: 1, repository_exact_match: 1 }), 2);
  assert.equal(scoreClockifyResolverCandidate(model, { issue_id_exact_match: 1, repository_exact_match: 0 }), -1);
  assert.equal(scoreClockifyResolverCandidate(model, { issue_id_exact_match: 0, repository_exact_match: 1 }), 1);
});

test('rejects artifacts with invalid tree shape or missing numeric candidate feature', () => {
  assert.throws(() => validateClockifyResolverModel({ ...model, trees: [{ ...model.trees[0], leafValues: [0] }] }), /leaf/i);
  assert.throws(() => scoreClockifyResolverCandidate(model, { issue_id_exact_match: 1 }), /feature/i);
});
