const MAX_FEATURES = 32;
const MAX_TREES = 2048;
const MAX_TREE_DEPTH = 16;
const MAX_LEAVES = 1 << MAX_TREE_DEPTH;

function finiteNumber(value, message) {
  if (!Number.isFinite(value)) throw new TypeError(message);
  return value;
}

function object(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(message);
  return value;
}

/** Validates the constrained, numeric-only CatBoost export consumed by the extension. */
export function validateClockifyResolverModel(value) {
  const model = object(value, 'Resolver model must be an object.');
  if (model.version !== 3 || model.modelType !== 'catboost-oblivious-trees' || model.featureSchemaVersion !== 3) {
    throw new TypeError('Resolver model version is unsupported.');
  }
  if (!Array.isArray(model.features) || !model.features.length || model.features.length > MAX_FEATURES
      || new Set(model.features).size !== model.features.length || model.features.some(feature => typeof feature !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(feature))) {
    throw new TypeError('Resolver model feature schema is invalid.');
  }
  finiteNumber(model.bias, 'Resolver model bias must be finite.');
  if (!Array.isArray(model.trees) || !model.trees.length || model.trees.length > MAX_TREES) throw new TypeError('Resolver model trees are invalid.');
  for (const tree of model.trees) {
    object(tree, 'Resolver model tree is invalid.');
    if (!Array.isArray(tree.splits) || !tree.splits.length || tree.splits.length > MAX_TREE_DEPTH) throw new TypeError('Resolver model tree splits are invalid.');
    if (!Array.isArray(tree.leafValues) || tree.leafValues.length !== 2 ** tree.splits.length || tree.leafValues.length > MAX_LEAVES) {
      throw new TypeError('Resolver model tree leaf values are invalid.');
    }
    for (const split of tree.splits) {
      object(split, 'Resolver model split is invalid.');
      if (!Number.isInteger(split.featureIndex) || split.featureIndex < 0 || split.featureIndex >= model.features.length) throw new TypeError('Resolver model split feature is invalid.');
      finiteNumber(split.threshold, 'Resolver model split threshold must be finite.');
    }
    tree.leafValues.forEach(leaf => finiteNumber(leaf, 'Resolver model leaf value must be finite.'));
  }
  const training = object(model.training, 'Resolver model training metadata is invalid.');
  if (typeof training.catBoostVersion !== 'string' || !training.catBoostVersion || typeof training.datasetVersion !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(training.datasetVersion)) {
    throw new TypeError('Resolver model training metadata is invalid.');
  }
  const evaluation = object(model.evaluation, 'Resolver model evaluation metadata is invalid.');
  if (typeof evaluation.groups !== 'string' || !evaluation.groups || evaluation.heldOutPrecision < 0 || evaluation.heldOutPrecision > 1 || evaluation.heldOutRecall < 0 || evaluation.heldOutRecall > 1) {
    throw new TypeError('Resolver model evaluation metadata is invalid.');
  }
  return model;
}

/** Returns the raw CatBoost logit; callers may use it only for ranking/suggestions. */
export function scoreClockifyResolverCandidate(modelArtifact, candidateFeatures) {
  const model = validateClockifyResolverModel(modelArtifact);
  const features = object(candidateFeatures, 'Resolver candidate features must be an object.');
  const values = model.features.map(feature => finiteNumber(features[feature], `Resolver candidate feature ${feature} must be finite.`));
  return model.trees.reduce((score, tree) => {
    const leafIndex = tree.splits.reduce((index, split, depth) => (
      index | ((values[split.featureIndex] > split.threshold ? 1 : 0) << depth)
    ), 0);
    return score + tree.leafValues[leafIndex];
  }, model.bias);
}
