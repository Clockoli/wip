# Self-Learning Resolver for Imported Clockify Time Entries

**Status:** Accepted MVP technical specification. Section 0 is normative for the MVP; later sections describe the original broader design and apply only where they do not conflict with Section 0.

## 0. Accepted MVP contract

### 0.1 Goal and provider scope

Build a privacy-preserving, self-learning resolver that runs during Clockify migration and identifies a canonical **GitHub issue or pull request** when reliable evidence exists. It does not modify Clockify.

The MVP supports GitHub only. GitLab, Jira, Linear, ClickUp, Trello, Asana, Todoist, and generic Clockify integrations are future providers. Their field patterns may be recorded as parser research, but must not produce an external URL in this release.

The verified Clockify field-mapping table is an input constraint: Description, Project, Task, and Tags have provider-specific semantics. In particular, GitHub commonly provides `#N title` in Description and Task plus a repository name in Project; this is not a universal mapping contract.

### 0.2 Resolver placement and data flow

The resolver runs after the existing Detailed Report normalizer and before the migration preview and `clockify-record-import` write path:

```text
Clockify Detailed Report
        ↓
existing report normalizer
        ↓
privileged resolver input snapshot
        ↓
evidence extraction and bounded candidate discovery
        ↓
canonical metadata retrieval → CatBoost ranking → final GitHub validation
        ↓
migration preview: auto-applied result, suggestion, correction, or unresolved
        ↓
clockify-record-import
```

The resolver sees the normalized Clockify entry while its project, task, description, tags, source user, timestamps, and source entry ID are still available. `clockify-record-import` remains the sole writer of Clockoli work records.

### 0.3 Resolution tiers

1. **Automatic application** is permitted only if all of these are true:
   - deterministic parsing extracted a positive GitHub issue/PR number and an exact repository;
   - the canonical `owner/repository` is in the explicit resolver allowlist for the current workspace;
   - the privileged GitHub validator confirms the same canonical repository, number, canonical URL, entity type, and title where a title was extracted.
2. **Suggestion** covers every result relying on fuzzy title similarity, workspace or user history, learned patterns, CatBoost score, partial repository evidence, or any other non-deterministic signal. The migration preview shows its evidence and requires explicit confirmation or a correction before import.
3. **Unresolved** entries receive no speculative external URL and import through the current Clockify project-derived URL/title behavior.

There is no probability-only automatic tier. A CatBoost score may order candidates and produce an explainable suggestion, but it cannot itself assign an external URL or bypass canonical GitHub validation and preview confirmation. The automatic tier, not the aggregate suggestion quality, must reach at least 99% precision on a leakage-resistant held-out dataset. Precision takes priority over coverage.

### 0.4 Candidate generation and GitHub validation

Candidate discovery is bounded and restricted to a workspace-level allowlist of canonical GitHub coordinates, for example:

```json
{
  "githubResolver": {
    "repositories": [
      "manticoresoftware/manticoresearch",
      "manticoresoftware/columnar",
      "manticoresoftware/buddy",
      "manticoresoftware/clockoli"
    ]
  }
}
```

The MVP must not scan every repository available to the user or GitHub App, discover organization repositories automatically, or expand host permissions. A configured maximum candidate count prevents broad issue-number fan-out.

The resolver's purpose is URL prediction, not merely rejection. It first retains explicit canonical references as candidates. When a reference is incomplete or absent, it may generate candidates from: an exact or locally learned Project-to-allowlisted-repository mapping; previously validated workspace/user history; and a bounded authenticated GitHub issue/PR search constrained to each already-allowlisted repository. Search text is derived only from the minimized Task, Description, and Tags fields. The candidate pool is deduplicated by canonical URL, capped before metadata retrieval, and never expanded from arbitrary repositories or accounts.

Each discovered candidate must have canonical GitHub metadata retrieved through the privileged client before it can receive title-similarity features. CatBoost ranks those retrieved candidates; its score and margin determine preview order only. The selected candidate is then canonically validated again (or the metadata retrieval proves the same strict validation contract) before it is shown as a suggestion. A score can never fabricate a URL, authorize an unvalidated entity, or auto-import a fuzzy result. If candidate discovery produces no canonical candidates, the entry is unresolved only after that bounded discovery path has been exhausted.

GitHub validation runs only in the privileged extension background/service worker through the existing authenticated GitHub client. It never uses Clockify cookies, browser-page requests, content-script credentials, visible tabs, or a new host permission. A successful HTTP response alone is insufficient: validation must prove the canonical candidate fields used for the result. Validation results are cached locally by resolver scope and canonical candidate identity.

### 0.5 Local resolver storage and privacy

All resolver state is local to extension-origin IndexedDB and scoped by the pair:

```text
(validated Clockify workspace ID, configured Clockoli data-repository stable ID)
```

The workspace ID and repository ID are established by privileged extension code. An untrusted Clockify content script may provide page-derived data, but cannot choose an authority scope.

IndexedDB stores only what the resolver needs:

- minimized normalized Clockify resolver fields;
- extracted features and parser pattern;
- generated candidates, scores, and explainable evidence;
- GitHub validation-cache results;
- selected resolution, user confirmation, and manual corrections;
- training samples, labels, weights, validation source, and resolver/model/feature-schema versions;
- workspace-level repository allowlist and locally imported model artifact.

The GitHub data repository continues to store only canonical Clockoli work records and the existing opaque Clockify provenance hash. It must never receive raw Clockify reports, original resolver fields, candidate lists, scores, validation history, corrections, training samples, or model artifacts.

Resolver storage, exports, UI, logs, Git history, and model artifacts must exclude Clockify credentials, cookies, request headers, request metadata, raw provider responses outside the bounded normalized resolver snapshot, and GitHub credentials.

### 0.6 Offline CSV corpus, labels, and corrections

Clockify's user-exported CSV is the initial offline corpus for parser research, feature extraction, candidate generation, and supervised training. It is supplied to a separate local training tool; the extension does not upload, parse, or retain the full CSV merely to train a model.

A raw Clockify CSV is not a label source. The offline corpus therefore has two explicit inputs: the original Clockify CSV and a separately maintained candidate-label CSV keyed by a stable source-row identity. Its exact header is `schema_version,source_file_sha256,source_record_number,candidate_url,candidate_title,label`. `label` is `positive` or `negative` for a genuine canonical GitHub issue/PR candidate; an explicit unresolved/skip decision has an empty candidate URL/title and label `unresolved` or `skip`. `candidate_title` is optional and is populated only after a GitHub entity has been read and validated. A source row has at most one positive candidate. Training URLs must be canonical `https://github.com/manticoresoftware/<repository>/(issues|pull)/<number>` URLs. The organization boundary does not itself authorize every repository at runtime: each Clockify workspace retains an explicit, bounded repository subset selected from that organization. The trainer rejects rows without a stable join key, duplicate contradictory labels, unsupported columns, or a GitHub URL outside the training allowlist.

The optional label-generation step is a local, read-only authenticated `gh api graphql` operation, so it can validate repositories that are private to the authenticated account. For an exact `Project` plus a single `#N`, it records a positive only after GitHub confirms that canonical entity. It may add one negative only when GitHub has separately validated a different-number entity in the same repository; this is a guaranteed counterfactual, not a guessed title match. Inaccessible repositories, deleted entities, multiple issue numbers, and missing numbers remain unresolved.

The observed `manticore_reports/Clockify_Time_Report_Detailed_*.csv` corpus (2021–2026) has the stable header `Project`, `Client`, `Description`, `Task`, `User`, `Group`, `Email`, `Tags`, `Billable`, `Start Date`, `Start Time`, `End Date`, `End Time`, `Duration (h)`, `Duration (decimal)`, `Billable Rate (0)`, `Billable Amount (0)`, and `Date of creation`. The corpus is structurally valid CSV, but it contains neither a Clockify workspace ID nor a stable Clockify time-entry ID.

The CSV adapter accepts only `Project`, `Description`, `Task`, `User`, `Tags`, `Start Date`, `Start Time`, `End Date`, `End Time`, and `Duration (decimal)` as training evidence. `Project` is the repository identity: its normalized value must name the repository segment of every labelled GitHub URL, under the fixed `manticoresoftware` owner. It must ignore `Client`, `Group`, `Email`, billable fields, and creation date. The corpus manifest records each source file's SHA-256 and header version. A label key is the tuple `(source file SHA-256, one-indexed CSV record number)`; labels are deliberately corpus-version-specific rather than pretending to be durable Clockify IDs. Missing fields remain missing evidence; they must not be fabricated from title matching.

The extension records a minimized local sample only for a remotely validated candidate or an explicit preview decision. It may explicitly export those decision samples as a second CSV for incremental offline retraining, but its export never includes credentials, cookies, headers, request data, raw provider responses, or unrelated Clockoli records.

Manual correction is the strongest label. When a user changes one genuine candidate to another, the rejected candidate is labelled negative and the selected candidate positive. The resolver must not infer negatives for alternatives that were not genuine candidates or could legitimately represent the same work.

### 0.7 MVP CatBoost ranker and offline training

CatBoost is the MVP's primary candidate ranker. The packaged extension remains dependency-free browser-native JavaScript: it does not package Python, the CatBoost Python package, a training runtime, or a generic CatBoost runtime. It performs deterministic parsing, feature extraction, bounded candidate generation, portable CatBoost inference, validation, preview/correction, and local sample collection.

Training is a separate local/offline Python tool using a version-pinned CatBoost environment. It reads the versioned Clockify corpus CSV plus GitHub-validated candidate-label CSV (or an explicitly exported extension decision CSV), produces reproducible metrics and a portable model artifact, and has no network requirement after the corpus and labels are present. No backend, remote trainer, sentence-transformers runtime, or third-party data transfer is part of the MVP.

The bootstrap dataset is the real Clockify Detailed Report corpus. The authenticated, read-only `gh api graphql` label generator establishes exact GitHub-positive examples from `Project` plus a single explicit issue/PR number and creates negatives only from a separately verified alternative entity in the same repository. It must never create a label from title similarity alone. The current 2021–2026 corpus and generated labels are local ignored training inputs, not extension data and not Git artifacts.

The trainer retains logistic regression as an evaluation baseline; it is not the production model. Training and evaluation use leakage-resistant group splits by source file and source user, so variants of the same source entry or user history cannot appear in both train and held-out partitions.

The shipped artifact is `resolver-model-v3.json`. It is a strict, versioned portable representation emitted by the offline CatBoost exporter, not a raw arbitrary CatBoost JSON dump. It contains only the evaluator's fixed numeric feature schema, deterministic preprocessing metadata, ordered oblivious-tree splits, leaf values, the CatBoost/exporter version, corpus/label digest, and held-out metrics. The JS evaluator validates every field, feature index, threshold, leaf count, finite value, size bound, and schema version before accepting an import; it preserves the previous valid artifact if validation fails. For example:

```json
{
  "version": 3,
  "modelType": "catboost-oblivious-trees",
  "featureSchemaVersion": 3,
  "features": [
    "issue_id_exact_match",
    "repository_exact_match",
    "title_token_jaccard",
    "title_prefix_similarity",
    "title_edit_similarity",
    "pattern_type_code",
    "repository_validation_frequency",
    "user_repository_frequency"
  ],
  "trees": [{
    "splits": [{ "featureIndex": 0, "threshold": 0.5 }],
    "leafValues": [-1.2, 2.8]
  }],
  "bias": 0.0,
  "training": { "catBoostVersion": "pinned-by-trainer", "datasetVersion": "sha256:..." },
  "evaluation": { "heldOutPrecision": 0.99, "heldOutRecall": 0.0, "groups": "source_file_sha256+user" }
}
```

The feature schema deliberately uses portable numeric features. `pattern_type`, repository, and user information enter it through deterministic pattern codes and bounded local frequency/statistical features rather than CatBoost native categorical/CTR state. This keeps the packaged evaluator auditable and prediction-compatible without importing a full CatBoost runtime. Native CatBoost categorical features and CTR tables are a later artifact/runtime compatibility project, not a reason to weaken the MVP ranker.

The MVP title-similarity features are normalized-prefix match, token Jaccard overlap, and normalized edit-distance similarity. `sentence-transformers` and embeddings remain deferred. CatBoost learns the interactions among title signals, exact issue/repository evidence, parser pattern, and local validated-history features; it remains a ranker/suggestion model rather than an authority source.

### 0.8 MVP deliverables

1. Privileged resolver scope derivation from Clockify workspace ID plus configured Clockoli repository stable ID.
2. IndexedDB schema, migrations, bounds, retention policy, and explicit dataset/model import-export flows.
3. Deterministic GitHub parser for supported `#N` patterns and repository/title extraction across all normalized Clockify fields.
4. Explicit workspace allowlist management and bounded deterministic candidate generation.
5. Privileged GitHub issue/PR validation, local cache, and evidence model.
6. Migration-preview rendering for automatic outcomes, suggestions, confirmation, correction, and unresolved entries.
7. Import integration that uses a confirmed canonical GitHub URL/title only when the applicable tier permits it; otherwise it preserves current import behavior.
8. Versioned, explicitly mapped Clockify CSV corpus adapter and separately keyed label CSV contract; no guessed provider schema.
9. Training-sample and correction collection, with safe label rules and user-initiated minimized decision-sample CSV export.
10. Local/offline CatBoost trainer, portable artifact exporter, logistic baseline evaluation, and a validated versioned model-artifact import flow.
11. Tests for CSV schema/label rejection, parser patterns, reject paths, sender/privacy boundaries, service-worker restart, scope isolation, validation cache, confirmation ordering, importer fallback, dataset minimization, artifact validation, and precision evaluation.

### 0.9 Explicit non-goals

- Silent resolution from fuzzy, historical, user-specific, learned-pattern, or logistic-regression evidence.
- Arbitrary title-only resolution, including Trello, Asana, and Todoist historical entries.
- Repository discovery/scanning outside the explicit allowlist.
- Changes to original Clockify entries.
- Writing resolver state or learning data to the GitHub data repository.
- Treating an unlabeled Clockify CSV as supervised training data, or inferring labels from title similarity.
- Replacing the authenticated Detailed Report migration input or its source provenance with a CSV import.
- LLM inference, embeddings, transformer training, a backend, a generic/full CatBoost runtime, or any remote training service.
- GitLab, Jira, Linear, ClickUp, Trello, Asana, Todoist, and generic-provider validation in the MVP.

---

## 1. Overview

Develop a resolver that normalizes inconsistent Clockify time entries created in different ways:

- via the Clockify browser extension;
- manually by users;
- via different integrations;
- by different versions of the Clockify extension over time.

The resolver should reconstruct the most likely original external work item, such as a GitHub issue, pull request, GitLab issue, Jira ticket, or other supported entity.

Example input:

```text
description = "4581"
project = null
task = "manticoresearch: #4581 avoid RT @files crash on concurrent string updates"
tags = []
user = "John"
```

Another possible input:

```text
description = "#13 Create a migration plugin for Clockify"
project = null
task = "clockoli-issues"
```

Or:

```text
description = "Correspondence/analyzing results"
task = "Libraesva: #2 Join performance issue"
```

Expected normalized output:

```json
{
  "provider": "github",
  "organization": "manticoresoftware",
  "repository": "manticoresearch",
  "entity_type": "issue",
  "external_id": "4581",
  "title": "avoid RT @files crash on concurrent string updates",
  "external_url": "https://github.com/manticoresoftware/manticoresearch/issues/4581",
  "confidence": 0.997
}
```

The primary goal is to identify the original repository/project/work item as accurately as possible regardless of how the Clockify entry was created.

---

## 2. High-Level Architecture

The resolver should operate as a pipeline:

```text
Raw Clockify entry
        ↓
Feature extraction
        ↓
Candidate generation
        ↓
Candidate scoring
        ↓
Confidence evaluation
        ↓
 ┌─────────────────┐
 │ High confidence │
 └────────┬────────┘
          ↓
    Accept result

or

Uncertain result
        ↓
Remote validation
        ↓
Positive / negative sample
        ↓
Training dataset
```

Machine learning should not be used for parsing patterns that can be handled reliably with deterministic rules.

For example:

```text
#4581
4581
MC-123
repo: #4581 title
```

should first be parsed using regexes and deterministic extractors.

ML should be used primarily for:

- ranking candidate entities;
- resolving ambiguous inputs;
- matching similar or truncated titles;
- learning from previously validated resolutions;
- reducing the number of remote validation requests over time.

---

## 3. Input

Minimum input structure:

```ts
interface RawTimeEntry {
    id: string;

    description?: string;
    project?: string;
    task?: string;
    tags?: string[];

    userId?: string;
    userName?: string;

    start?: string;
    end?: string;

    workspaceId?: string;
}
```

The resolver must consider all available fields together.

It must **not** assume that:

```text
Clockify Project = repository
Clockify Task = external task
Clockify Description = task title
```

Clockify integrations use different mappings, so the semantics of these fields are not consistent.

---

## 4. Output

```ts
interface ResolvedEntity {
    provider?: "github" | "gitlab" | "jira" | "unknown";

    organization?: string;
    repository?: string;

    entityType?:
        | "issue"
        | "pull_request"
        | "merge_request"
        | "task";

    externalId?: string;
    title?: string;
    externalUrl?: string;

    confidence: number;

    resolutionMethod:
        | "deterministic"
        | "learned-pattern"
        | "ml"
        | "remote-validation"
        | "unresolved";

    evidence: Evidence[];
}
```

Example evidence:

```json
[
  {
    "type": "issue_id_in_task",
    "value": "4581"
  },
  {
    "type": "repository_in_task",
    "value": "manticoresearch"
  },
  {
    "type": "known_repository",
    "value": "manticoresoftware/manticoresearch"
  },
  {
    "type": "title_similarity",
    "value": 0.94
  }
]
```

Raw Clockify data must never be destroyed or overwritten by normalized data.

---

## 5. Feature Extraction

The resolver should extract possible identifiers, repositories, projects, titles, and integration-specific patterns from all Clockify fields.

### 5.1 External IDs

Support at least the following formats:

```text
#4581
4581
GH-4581
ABC-123
!4581
```

Required regex categories:

```text
#<number>
<number>
<PROJECT>-<number>
!<number>
```

The implementation may add additional provider-specific patterns later.

### 5.2 Repository / Project Candidates

Examples:

```text
manticoresearch: #4581 title
clockoli-issues: #13 title
manticoresearch/columnar#123
manticoresoftware/manticoresearch#123
```

The resolver should attempt to extract:

```text
repositoryCandidate
organizationCandidate
```

### 5.3 Title Candidates

From:

```text
manticoresearch: #4581 avoid RT @files crash on concurrent string updates
```

extract:

```text
avoid RT @files crash on concurrent string updates
```

From:

```text
#13 Create a migration plugin for Clockify
```

extract:

```text
Create a migration plugin for Clockify
```

---

## 6. Candidate Generation

Based on extracted features, generate one or more possible external entities.

Example:

```text
repo = manticoresearch
id = 4581
```

Possible candidates:

```text
GitHub:
manticoresoftware/manticoresearch/issues/4581

GitHub:
manticoresoftware/manticoresearch/pull/4581
```

If the repository is unknown:

```text
#4581 title
```

the candidate generator may use repositories known for the current workspace:

```text
manticoresoftware/manticoresearch
manticoresoftware/columnar
manticoresoftware/buddy
manticoresoftware/clockoli
```

The number of generated candidates must be configurable.

Example:

```text
MAX_CANDIDATES = 20
```

Candidate generation must be deterministic and independent from the ML model.

---

## 7. Repository Knowledge Base

The resolver should gradually build a local knowledge base of known repository mappings.

Example:

```json
{
  "manticoresearch": {
    "provider": "github",
    "organization": "manticoresoftware",
    "repository": "manticoresearch",
    "confidence": 0.999,
    "observations": 486
  }
}
```

After enough successful validations:

```text
manticoresearch
```

can be resolved to:

```text
github.com/manticoresoftware/manticoresearch
```

without a network request.

The knowledge base must be scoped at least by:

```text
workspace
```

Optionally, additional statistics may be maintained for:

```text
workspace + user
```

User-specific knowledge must not override stronger deterministic evidence.

---

## 8. Candidate Features for ML

Each pair:

```text
RawTimeEntry + Candidate
```

should be transformed into a feature vector.

Minimum feature set:

```text
issue_id_exact_match
issue_id_found_in_description
issue_id_found_in_task
issue_id_found_in_project

repo_exact_match
repo_partial_match
repo_seen_before
repo_frequency

title_exact_match
title_token_similarity
title_edit_distance
title_embedding_similarity

provider_probability

same_user_repo_frequency
same_workspace_repo_frequency

pattern_type

candidate_verified_before
candidate_repository_verified_before
```

Example:

```json
{
  "issue_id_exact_match": 1,
  "issue_id_found_in_description": 1,
  "issue_id_found_in_task": 1,

  "repo_exact_match": 1,
  "repo_seen_before": 1,

  "title_embedding_similarity": 0.93,

  "same_user_repo_frequency": 0.71,
  "same_workspace_repo_frequency": 0.95,

  "pattern_type": "repo_colon_hash_id_title"
}
```

---

## 9. Machine Learning Model

For the first ML version, use:

```text
CatBoostClassifier
```

The target is:

```text
candidate_is_correct
```

Each training sample is:

```text
(entry, candidate, features, label)
```

Positive example:

```text
Clockify:
4581
manticoresearch: #4581 avoid RT...

Candidate:
manticoresoftware/manticoresearch/issues/4581

label = 1
```

Negative example:

```text
Candidate:
manticoresoftware/columnar/issues/4581

label = 0
```

### Why CatBoost

CatBoost is suitable because the feature set contains a mix of:

- booleans;
- numerical similarity scores;
- categorical values;
- sparse historical statistics;
- pattern categories;
- user/workspace/repository identifiers.

It should provide strong results before introducing more complex ranking architectures.

A later version may evaluate `LightGBM Ranker` if pairwise ranking becomes more appropriate than binary classification.

---

## 10. Title Similarity

Use text embeddings for comparing extracted Clockify titles with external issue/task titles.

Recommended initial implementation:

```text
sentence-transformers
```

Input:

```text
Clockify extracted title
External candidate title
```

Output:

```text
cosine similarity
```

Example:

```text
Clockify:
fix binary proto supp...

GitHub:
Fix binary protocol support for ...

similarity = 0.91
```

The embedding model must **not** make the final resolution decision.

Its score is only one feature passed to the primary candidate scoring model.

---

## 11. Remote Validation

If the resolver does not have sufficient confidence, it should validate the top candidate(s) against the external provider.

For GitHub, prefer the official API.

Example:

```text
GET /repos/{owner}/{repo}/issues/{id}
```

Validation should return at least:

```ts
interface ValidationResult {
    exists: boolean;
    title?: string;
    repository?: string;
    type?: string;
    url?: string;
}
```

An HTTP `200` alone is not sufficient.

Validation should also consider:

```text
external ID
repository
title similarity
entity type
```

A validation result should be converted into a positive or negative training signal.

---

## 12. Validation from the Browser Extension

If the resolver runs inside a browser extension, it may use the current user's authenticated browser session where technically and legally appropriate.

Preferred order:

```text
official API
↓
authenticated fetch
↓
page request
```

The extension should **not** open visible browser tabs solely for validation.

Validation should run in the extension background/service worker.

Required extension permissions should be kept to the minimum necessary.

---

## 13. Confidence Thresholds

The model should return a probability:

```text
0.0 ... 1.0
```

Initial thresholds:

```text
>= 0.98
accept automatically

0.75 – 0.98
perform remote validation

< 0.75
leave unresolved
```

Thresholds must be configurable.

The priority is precision, not maximum recall.

A wrong automatic resolution is significantly worse than leaving an entry unresolved.

---

## 14. Learning Loop

Every successful or failed remote validation should produce training data.

Example:

```text
Candidate A: manticoresearch/#4581 → correct
Candidate B: columnar/#4581       → incorrect
Candidate C: buddy/#4581          → incorrect
```

Training labels:

```text
A = 1
B = 0
C = 0
```

If one candidate is validated as correct, the other candidates generated for the same Clockify entry may be stored as negative samples, provided they were genuine alternatives.

Care must be taken to avoid creating invalid negatives when multiple external entities could legitimately represent the same work item.

---

## 15. Training Dataset

Store resolver training samples separately from normalized time entries.

Suggested table:

```sql
resolver_training_samples
```

Suggested fields:

```text
id
workspace_id
entry_id

candidate_provider
candidate_organization
candidate_repository
candidate_entity_type
candidate_external_id

features JSON

label

validation_method
validated_at

model_version
```

Optionally store:

```text
sample_weight
validation_source
manual_correction
```

Manual corrections should receive higher training weight than inferred labels.

---

## 16. Model Training

The model does not need to retrain after every new sample.

Initial strategy:

```text
collect samples
→ retrain periodically
```

Example triggers:

```text
every 1,000 new validated samples
```

or:

```text
once per day
```

Each trained model version should store:

```text
model version
training dataset version
training timestamp
metrics
feature schema version
```

The system must support rolling back to a previous model version.

---

## 17. Evaluation

The dataset should be split into:

```text
train
validation
test
```

The split should not be purely random.

To reduce leakage, some combinations of:

```text
repository
user
pattern
```

should appear only in the test set.

### Primary Metric: Precision

Precision is the most important metric.

For automatic resolution:

```text
target precision >= 99%
```

### Secondary Metrics

Also track:

```text
recall
F1
ROC-AUC
PR-AUC
coverage at confidence threshold
remote-validation rate
false-positive rate
```

A useful operational metric is:

```text
percentage of entries resolved automatically
while keeping precision >= 99%
```

---

## 18. Remote Validation Cache

Remote validation results must be cached.

Suggested cache key:

```text
provider
organization
repository
entity_type
external_id
```

Example:

```text
github:
manticoresoftware:
manticoresearch:
issue:
4581
```

Once a specific entity has been validated, repeated entries should reuse the cached result.

The cache should support configurable TTLs where appropriate.

For immutable historical issue IDs, long-lived caching is acceptable.

---

## 19. Pattern Learning

In addition to the ML model, maintain statistics for recurring deterministic patterns.

Example:

```text
pattern:
"{repo}: #{id} {title}"

observed:
938

provider:
github

success_rate:
99.7%
```

A sufficiently well-established pattern may become a fast path before ML.

Suggested resolution order:

```text
known deterministic pattern
        ↓
candidate generation
        ↓
ML ranking
        ↓
remote validation
```

This reduces latency and external API usage.

---

## 20. User-Specific Patterns

Different users may create time entries differently.

Example:

```text
User A:
usually uses the Clockify browser extension

User B:
usually enters only the issue number manually
```

The resolver may use:

```text
userId
```

as a feature.

However, user-specific history must never override strong direct evidence such as:

```text
exact repository + exact issue ID
```

User-specific statistics should be treated as weak or medium-strength contextual signals.

---

## 21. Explainability

Every resolution must be explainable.

The system should expose a human-readable explanation such as:

```text
Resolved to:
manticoresearch#4581

Confidence:
99.6%

Evidence:
+ exact issue ID match
+ exact repository match
+ title similarity 94%
+ repository previously confirmed 312 times
```

This information is required for:

- debugging;
- migration validation;
- reviewing incorrect resolutions;
- understanding model regressions.

---

## 22. Manual Correction

Users or administrators must be able to correct an incorrect resolution.

Example:

```text
Incorrect:
manticoresearch#4581

Correct:
columnar#4581
```

This correction should generate:

```text
negative sample for the incorrect candidate
positive sample for the corrected candidate
```

Manual corrections should receive a larger training weight than automatic remote-validation labels.

The original raw Clockify entry must remain unchanged.

---

## 23. Provider Abstraction

The first implementation should support:

```text
GitHub
```

The architecture must allow additional providers to be added later:

```text
GitLab
Jira
Linear
Trello
```

Suggested provider interface:

```ts
interface ExternalProvider {
    generateCandidates(
        entry: RawTimeEntry,
        extracted: ExtractedFeatures
    ): Candidate[];

    validate(
        candidate: Candidate
    ): Promise<ValidationResult>;
}
```

Provider-specific parsing may be added where required, but the common resolver pipeline should remain provider-agnostic.

---

## 24. Non-Goals for the First Version

The first version does **not** need to:

- invent repositories that are not known to the workspace;
- use an LLM;
- train a transformer model from scratch;
- resolve arbitrary natural-language descriptions with no useful identifiers;
- resolve every historical Clockify entry;
- modify original Clockify records;
- support every Clockify integration immediately;
- perform reinforcement learning.

The first version should prefer reliable partial resolution over speculative full resolution.

---

## 25. MVP Plan

### Phase 1 — Deterministic Resolver

Scope:

```text
GitHub only
regex / parser
candidate generator
known repository mapping
GitHub remote validation
confidence scoring
training dataset collection
```

Deliverables:

- raw input parser;
- feature extraction;
- candidate generation;
- repository knowledge base;
- GitHub validation;
- validation cache;
- evidence output;
- storage of positive/negative examples.

### Phase 2 — ML Candidate Scoring

Add:

```text
CatBoost
basic string similarity
automatic candidate scoring
configurable confidence thresholds
```

Deliverables:

- feature vector builder;
- CatBoost training pipeline;
- model versioning;
- inference service/module;
- evaluation metrics.

### Phase 3 — Semantic Similarity and Pattern Learning

Add:

```text
sentence-transformer embeddings
pattern learning
user/workspace history
```

Deliverables:

- title embedding feature;
- pattern statistics;
- fast-path resolver;
- user/workspace historical features.

### Phase 4 — Additional Providers

Add:

```text
GitLab
Jira
Linear
other providers as needed
```

Each provider must implement the common provider abstraction.

---

## 26. Acceptance Criteria

The implementation is accepted when all of the following are true.

### Input Handling

The resolver accepts arbitrary combinations of:

```text
description
project
task
tags
```

### Supported GitHub Patterns

At minimum, it correctly handles patterns such as:

```text
4581
#4581 title
manticoresearch: #4581 title
#4581 title + manticoresearch
manticoresearch/#4581 title
```

### Resolution Output

When sufficient evidence exists, the resolver identifies:

```text
repository
issue ID
title
external URL
```

### Confidence Behavior

- High-confidence results can be accepted without remote validation.
- Medium-confidence results trigger remote validation.
- Low-confidence results remain unresolved.

### Learning

- Remote validation results are stored as training samples.
- Manual corrections generate training signals.
- A CatBoost model can be retrained from accumulated validated samples.
- Previously learned repository mappings reduce unnecessary validation requests.

### Explainability

Every result contains:

```text
confidence
resolution method
evidence
```

### Quality Target

For automatically accepted resolutions on the test dataset:

```text
precision >= 99%
```

Coverage should be measured separately and optimized only after the precision target is met.

---

## 27. Suggested Project Name

Recommended issue / epic title:

```text
Create a self-learning resolver for imported Clockify entries
```

The term **self-learning resolver** is preferred over **ML parser** because machine learning is only one stage of the overall resolution pipeline.
