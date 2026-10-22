# Data format v1

The normative format of the files Clockoli writes to a time repository: active timers, monthly JSONL time records, and the task index.

**Status:** Canonical Version 1
**Scope:** Persistent Clockoli work data stored in the user's GitHub repository
**Compatibility:** Clockoli supports only this format. There is no legacy reader or migration contract.

---

## 1. Model

A Clockoli work record describes:

```text
work record = actor + work item + activity + producer
```

with optional description, metadata, metrics, and execution context.

The model supports human time tracking now and allows other actor kinds and measurements later without changing the root schema.

---

## 2. Repository storage profile

The repository stores one running human record per storage login and completed records partitioned by the activity's local start month:

```text
active/{storage-login}.json
times/{YYYY-MM}/{storage-login}.jsonl
```

Rules:

- an active file contains exactly one JSON object followed by `\n`;
- a monthly file is JSON Lines: one complete JSON object per line, with a final `\n`;
- blank lines are invalid;
- every completed record in a monthly file must have `activity.local_date` in that `YYYY-MM`;
- the storage login and partition path are routing metadata, not record identity;
- file paths and Git commit/blob SHAs must never be used as record IDs;
- writers update a monthly file with its expected blob SHA;
- Stop writes the completed monthly record and deletes the matching active file in one guarded Git commit;
- writers must reject malformed JSON, duplicate record IDs, a mismatched partition, and unsupported schema versions;
- serializers produce deterministic pretty JSON for active files and compact one-line JSON for JSONL files;
- object key order is not semantically significant.

A future storage profile may repartition records without changing their logical schema or IDs.

---

## 3. Canonical work record

```json
{
  "schema_version": 1,
  "id": "01K3X7Q8N8F4J7R2JQZ5AKP1MD",
  "record_type": "work",
  "actor": {
    "kind": "human",
    "id": "github:12345678",
    "name": "sergey"
  },
  "work_item": {
    "kind": "github_issue",
    "id": "url:https://github.com/acme/foo/issues/123",
    "url": "https://github.com/acme/foo/issues/123",
    "title": "Fix replication failure"
  },
  "activity": {
    "state": "completed",
    "started_at": "2026-08-26T08:15:00.000Z",
    "ended_at": "2026-08-26T09:42:00.000Z",
    "local_date": "2026-08-26",
    "timezone": "Europe/Berlin"
  },
  "producer": {
    "kind": "browser_extension",
    "name": "clockoli-chrome",
    "version": "0.2.0"
  },
  "description": "Investigated replication failure and prepared fix",
  "metadata": {
    "billable": true
  },
  "metrics": {},
  "created_at": "2026-08-26T09:42:05.000Z",
  "updated_at": "2026-08-26T09:42:05.000Z"
}
```

Required root fields:

```text
schema_version
id
record_type
actor
work_item
activity
producer
description
metadata
metrics
created_at
updated_at
```

`description` may be an empty string. `metadata` and `metrics` may be empty objects. Keeping their shapes present makes the version-1 envelope predictable while allowing additive extensions.

---

## 4. Schema and record type

```json
{
  "schema_version": 1,
  "record_type": "work"
}
```

Rules:

- `schema_version` must equal `1`;
- `record_type` must equal `work` for tracked work;
- an unsupported version or record type is rejected;
- a breaking semantic change requires a future schema version;
- additive fields do not require a new version when existing semantics remain unchanged.

---

## 5. Stable record ID and lifecycle

Every record has a globally unique immutable ULID:

```json
{
  "id": "01K3X7Q8N8F4J7R2JQZ5AKP1MD"
}
```

Rules:

- the ID is generated before Start is accepted;
- the running record and its completed form use the same ID;
- Stop completes the existing logical record; it does not create another record ID;
- edits preserve the ID;
- retries preserve the ID;
- duplicate detection uses the ID and does not depend on path, URL, timestamps, actor, Git SHA, title, description, or array position;
- a monthly file must not contain duplicate IDs;
- a writer must not append an ID already persisted in the relevant data set as another logical work record.

The durable timer identity is the record ID. URL, title, description, timestamps, and Git SHAs are mutable or storage metadata.

---

## 6. Actor

`actor` identifies who or what performed the work.

### Human

```json
{
  "actor": {
    "kind": "human",
    "id": "github:12345678",
    "name": "sergey"
  }
}
```

### Extensible non-human shape

```json
{
  "actor": {
    "kind": "agent",
    "id": "agent:example:code-reviewer",
    "name": "Code Reviewer"
  }
}
```

Rules:

- `kind`, `id`, and `name` are required non-empty strings;
- `id` is provider-qualified and stable;
- GitHub humans use the immutable numeric GitHub user ID when available;
- `name` is display metadata and may change;
- actor identity is independent of the current browser, extension installation, producer, session, or execution attempt;
- the current Clockoli UI creates only `human` actors, but readers and rewrites must preserve other kinds.

---

## 7. Work item

```json
{
  "work_item": {
    "kind": "github_pr",
    "id": "url:https://github.com/acme/foo/pull/456",
    "url": "https://github.com/acme/foo/pull/456",
    "title": "Implement retry handling"
  }
}
```

Supported current kinds:

```text
github_issue
github_pr
url
```

Rules:

- `kind` and `id` are required;
- `url` is optional in the general schema, but required for work created by the current browser extension;
- `title` is a bounded display snapshot and may be empty;
- when a provider supplies an immutable object ID, writers should use a provider-qualified ID;
- otherwise the current browser writer uses `url:{canonical-url}`; imported unresolved records may use `url:{owner/project/task-slug}`;
- URL-derived identity follows Clockoli URL canonicalization;
- identity and display URL remain separate fields so a future writer can preserve identity across URL changes;
- the set of `kind` values is extensible.

Clockoli URL canonicalization:

- accepts only HTTP(S);
- rejects embedded username/password credentials;
- removes query strings and fragments from canonical GitHub issue/PR URLs;
- preserves query strings and fragments for other URLs because they may identify different work.

Imported unresolved Clockify work records and the personal-branch `.clockoli/tasks.json` projection recognize bare identities of the form `owner/project/task-slug` (for example `manticoresoftware/NexusRepo/Fixed-last-block-encoding`). These are task identities, not navigable URLs: they have exactly three slash-separated segments, a valid owner, an alphanumeric-starting project containing only letters, digits, dots, underscores or hyphens, and a non-empty alphanumeric/hyphen task slug. Store that identity unchanged in `work_item.url` and in the task index. Browser-created work still requires a canonical HTTP(S) URL; imports do not guess a GitHub URL from an unresolved identity.

---

## 8. Activity and calendar semantics

Completed activity:

```json
{
  "activity": {
    "state": "completed",
    "started_at": "2026-08-26T08:15:00.000Z",
    "ended_at": "2026-08-26T09:42:00.000Z",
    "local_date": "2026-08-26",
    "timezone": "Europe/Berlin"
  }
}
```

Running activity:

```json
{
  "activity": {
    "state": "running",
    "started_at": "2026-08-26T08:15:00.000Z",
    "ended_at": null,
    "local_date": "2026-08-26",
    "timezone": "Europe/Berlin"
  }
}
```

Rules:

- `state` is required and is `running` or `completed`;
- persisted timestamps are ISO 8601 UTC timestamps ending in `Z`;
- `local_date` is the actor-facing calendar date captured at Start and is immutable during Stop;
- `timezone` is the IANA timezone captured at Start;
- running activity has `ended_at: null`;
- completed activity has a valid `ended_at` not earlier than `started_at`;
- tracked duration is derived from the two timestamps;
- `local_date` controls monthly storage partitioning and calendar reports;
- editing `started_at` may deliberately change `local_date` and move the record to another monthly file;
- changing the browser timezone later must not reinterpret existing records.

---

## 9. Producer

`producer` identifies the concrete software writer, not the actor.

```json
{
  "producer": {
    "kind": "browser_extension",
    "name": "clockoli-chrome",
    "version": "0.2.0"
  }
}
```

Rules:

- `kind`, `name`, and `version` are required non-empty strings;
- producer identity must never be used as actor identity;
- a rewrite preserves the original producer unless the operation intentionally records different provenance in additive fields;
- future kinds may include CLI, import, or integration writers.

---

## 10. Description, metadata, and rates

```json
{
  "description": "Prepared the fix",
  "metadata": {
    "billable": true,
    "category": "development",
    "project_id": "acme-search"
  }
}
```

Rules:

- `description` is a string up to 2,000 characters;
- `metadata` is an object;
- metadata keys are extensible;
- unknown metadata must be preserved;
- reporting semantics for a metadata key must be documented before Clockoli aggregates it;
- sensitive rates remain local/private configuration and are not duplicated into ordinary records;
- `metadata.billable` may mark work as billable without storing a rate.

### 10.1 GitHub work-item snapshot

For canonical GitHub issue and pull-request URLs, Clockoli may capture provider context under `metadata.github` when a timer is synchronized. This namespace is optional and does not change the generic root schema.

```json
{
  "metadata": {
    "github": {
      "repository": { "id": 95614931, "node_id": "R_...", "full_name": "manticoresoftware/manticoresearch" },
      "item": { "number": 4825, "node_id": "PR_...", "type": "pull_request" },
      "author": { "id": 28719845, "node_id": "U_...", "login": "sanikolaev" },
      "assignees": [],
      "actor_relationship": ["author"],
      "state": { "value": "merged", "reason": null },
      "labels": [],
      "milestone": null,
      "timestamps": {
        "created_at": "2026-08-19T04:46:41.000Z",
        "updated_at": "2026-08-19T06:46:18.000Z",
        "closed_at": "2026-08-19T06:46:18.000Z",
        "merged_at": "2026-08-19T06:46:18.000Z"
      },
      "snapshot": {
        "captured_at": "2026-08-26T00:00:00.000Z",
        "source_updated_at": "2026-08-19T06:46:18.000Z",
        "provider": "github"
      }
    }
  }
}
```

Snapshot rules:

- the namespace records provider state observed when the timer was synchronized; old records are not rewritten when GitHub later changes;
- numeric GitHub IDs are preferred as rename-stable identities; node IDs are retained for GraphQL interoperability;
- `author` may be `null` when GitHub no longer exposes an author;
- `actor_relationship` may contain `author`, `assignee`, and `reviewer`; otherwise it contains `other`;
- pull requests may additionally include `pull_request.draft`, `merged`, base/head repository and ref context, and requested reviewers;
- full bodies, comments, timelines, reactions, and mutable aggregate counts are not stored;
- unknown fields inside `metadata.github` must be preserved like every other extension field.

---

## 11. Metrics

`metrics` stores optional measured values that are not canonical identity or activity timestamps.

```json
{
  "metrics": {
    "llm.input_tokens": {
      "value": 12500,
      "unit": "token",
      "aggregation": "sum",
      "source": "provider"
    },
    "execution.wall_time": {
      "value": 5220000,
      "unit": "ms",
      "aggregation": "sum",
      "source": "derived"
    },
    "cost.provider": {
      "value": "0.012345",
      "unit": "USD",
      "aggregation": "sum",
      "source": "provider"
    }
  }
}
```

Rules:

- `metrics` is an object and may be empty;
- metric names use a namespaced dotted form and must include enough semantics to avoid collisions;
- each metric is an object containing `value`, `unit`, `aggregation`, and `source`;
- supported numeric values are finite JSON numbers; precise decimal money values are decimal strings;
- `aggregation` is one of `sum`, `max`, `min`, `last`, or `none`;
- `source` describes provenance, such as `provider`, `producer`, `derived`, or `estimated`;
- unknown metrics and unknown additive metric properties must be preserved;
- metrics never replace `activity.started_at` or `activity.ended_at`;
- consumers must not assume all records contain the same metrics;
- parallel wall-clock intervals must not be interpreted as non-overlapping elapsed time merely because their metric aggregation is `sum`.

Clockoli does not yet create or interpret AI metrics; this contract reserves a stable representation for future writers.

---

## 12. Optional execution context

Session/run identity is separate from actor identity.

```json
{
  "execution": {
    "id": "run:01K3X7Q8N8F4J7R2JQZ5AKP1MD",
    "session_id": "session-123",
    "parent_id": null,
    "attempt": 1
  }
}
```

Rules:

- `execution` is optional;
- `execution.id` identifies one run;
- `session_id` groups related runs when a producer has that concept;
- `parent_id` allows run relationships;
- `attempt` is a positive integer;
- execution/session IDs must never be substituted for `actor.id` or record `id`;
- unknown execution fields must be preserved.

The current browser extension does not create execution context.

---

## 13. Creation and modification metadata

```json
{
  "created_at": "2026-08-26T09:42:05.000Z",
  "updated_at": "2026-08-26T09:42:05.000Z"
}
```

Rules:

- both timestamps are required UTC timestamps;
- `created_at` is immutable;
- `updated_at` changes when the logical record is edited;
- persistence timestamps never determine tracked duration;
- completing a running timer preserves `created_at` and updates `updated_at` to the completion write time.

---

## 14. Edits, unknown fields, and corrections

Clockoli version 1 updates the logical work record in place while preserving:

- `id`;
- `created_at`;
- actor identity unless the user explicitly changes the responsible actor in a future supported operation;
- all unknown root and nested fields.

Mandatory preservation rule:

> A reader that rewrites a supported record MUST preserve unknown root and nested fields unless their removal is explicitly part of the requested operation.

This includes unknown fields under `actor`, `work_item`, `activity`, `producer`, `metadata`, `metrics`, and `execution`.

The root `record_type` leaves room for a future append-only correction model, but version 1 supports only `record_type: work` and in-place edits.

---

## 15. Idempotency and duplicate handling

Rules:

- the record ID is generated before local acceptance and remote persistence;
- retries use the same record ID;
- Start retry must not create a second active logical record;
- Stop retry must not create another completed logical record;
- storage code detects duplicates by record ID;
- a persisted completion with the expected ID is the same logical Stop even when mutable metadata differs;
- Git commit SHA is concurrency metadata, not idempotency identity;
- imports may provide an additive `idempotency_key`, but Clockoli's own writes use `id`.

---

## 16. Validation

A valid work record contains:

```text
schema_version = 1
id = valid ULID
record_type = work
actor.kind, actor.id, actor.name
work_item.kind, work_item.id
activity.state, activity.started_at, activity.local_date, activity.timezone
producer.kind, producer.name, producer.version
description
metadata object
metrics object
created_at
updated_at
```

Additional rules:

- `updated_at >= created_at`;
- completed records require `activity.ended_at != null` and `ended_at >= started_at`;
- running records require `activity.ended_at = null`;
- monthly JSONL accepts completed records only;
- active JSON accepts a running record only;
- duplicate IDs in one monthly file are rejected;
- storage-path month must equal `activity.local_date.slice(0, 7)`;
- the actor name must match the file's immutable storage login for data created by the current human tracker;
- current browser-created work items require a valid canonical HTTP(S) URL;
- malformed or structurally invalid files are rejected as a whole, never partially ignored.

---

## 17. Compatibility principles

1. This is Clockoli's first and only persistent work-record format.
2. No old text-block format is supported.
3. Prefer additive fields over changed semantics.
4. Never reuse a field with a different meaning.
5. Keep actor, execution, producer, and record identities separate.
6. Keep work-item identity separate from display URL and title.
7. Keep activity timestamps separate from persistence timestamps.
8. Preserve local calendar semantics explicitly.
9. Preserve unknown fields on every rewrite.
10. Keep sensitive rates outside ordinary records.
11. Keep browser-specific implementation details out of the logical schema.
12. Any future breaking change requires a new explicit schema version and migration plan; version 1 defines no backward migration behavior.

---

## 18. Summary

```text
WorkRecord
├── schema_version = 1
├── id
├── record_type = work
├── actor
│   ├── kind
│   ├── id
│   └── name
├── work_item
│   ├── kind
│   ├── id
│   ├── url
│   └── title
├── activity
│   ├── state
│   ├── started_at
│   ├── ended_at
│   ├── local_date
│   └── timezone
├── producer
│   ├── kind
│   ├── name
│   └── version
├── execution (optional)
├── description
├── metadata
├── metrics
├── created_at
└── updated_at
```

The design principle is:

> A Clockoli record describes work performed by an actor on a work item, recorded by a producer, with stable identity, explicit activity timing, preserved calendar context, and extensible metadata and metrics.
