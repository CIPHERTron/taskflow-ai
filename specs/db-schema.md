# FlowTask AI — Database Schema and Models

PostgreSQL **16+** with **`pgvector`** extension. Migrations via **golang-migrate** (versioned SQL files, e.g. `infra/migrations/*.up.sql`).

Conventions:

- UUID primary keys: `gen_random_uuid()` (requires `pgcrypto` or UUIDv7 app-side).
- Timestamps in UTC: `timestamptz`.
- Soft delete: `deleted_at timestamptz NULL`.
- Optimistic locking: `version bigint NOT NULL DEFAULT 1` on `tasks`.

---

## 1. Enum Types

```sql
CREATE TYPE task_status AS ENUM (
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'IN_REVIEW',
  'DONE'
);

CREATE TYPE task_priority AS ENUM (
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT'
);

CREATE TYPE workspace_role AS ENUM (
  'OWNER',
  'ADMIN',
  'MEMBER',
  'VIEWER'
);

CREATE TYPE suggestion_status AS ENUM (
  'PENDING',
  'ACCEPTED',
  'DISMISSED',
  'EXPIRED'
);

CREATE TYPE agent_job_status AS ENUM (
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'RETRYING',
  'DEAD_LETTER'
);

CREATE TYPE agent_job_type AS ENUM (
  'TRIAGE',
  'BLOCKER',
  'BALANCER'
);
```

---

## 2. Core Tables

### 2.1 users

```sql
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  display_name    text NOT NULL,
  password_hash   text,
  avatar_url      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users (email);
```

### 2.2 workspaces

```sql
CREATE TABLE workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        citext NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workspaces_slug ON workspaces (slug);
```

### 2.3 workspace_members

```sql
CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         workspace_role NOT NULL DEFAULT 'MEMBER',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user ON workspace_members (user_id);
```

### 2.4 boards

```sql
CREATE TABLE boards (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  default_sprint_weeks int  NOT NULL DEFAULT 2 CHECK (default_sprint_weeks IN (1, 2)),
  event_seq            bigint NOT NULL DEFAULT 0,
  deleted_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_boards_workspace ON boards (workspace_id) WHERE deleted_at IS NULL;
```

### 2.5 board_members (board-level permissions)

```sql
CREATE TABLE board_members (
  board_id   uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_create_tasks boolean NOT NULL DEFAULT true,
  can_manage_agents boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);
```

### 2.6 columns

```sql
CREATE TABLE columns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       text NOT NULL,
  status     task_status NOT NULL,
  position   int NOT NULL,
  wip_limit  int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board_id, position)
);

CREATE INDEX idx_columns_board_position ON columns (board_id, position);
```

### 2.7 sprints

```sql
CREATE TABLE sprints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       text NOT NULL,
  goal       text,
  start_date date,
  end_date   date,
  started_at timestamptz,
  closed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sprints_board_started ON sprints (board_id, started_at);
```

### 2.8 tasks

```sql
CREATE TABLE tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id         uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id        uuid NOT NULL REFERENCES columns(id) ON DELETE RESTRICT,
  sprint_id        uuid REFERENCES sprints(id) ON DELETE SET NULL,
  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  status           task_status NOT NULL,
  priority         task_priority NOT NULL DEFAULT 'NONE',
  triage_score     double precision,
  assignee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  due_date         date,
  labels           text[] NOT NULL DEFAULT '{}',
  story_points     int CHECK (story_points IS NULL OR story_points >= 0),
  sort_order       bigint NOT NULL,
  version          bigint NOT NULL DEFAULT 1,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_board_column_sort ON tasks (board_id, column_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_board_assignee ON tasks (board_id, assignee_user_id)
  WHERE deleted_at IS NULL AND assignee_user_id IS NOT NULL;

CREATE INDEX idx_tasks_board_status ON tasks (board_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_board_sprint ON tasks (board_id, sprint_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_due_date ON tasks (board_id, due_date)
  WHERE deleted_at IS NULL AND due_date IS NOT NULL;
```

### 2.9 subtasks

```sql
CREATE TABLE subtasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title       text NOT NULL,
  completed   boolean NOT NULL DEFAULT false,
  sort_order  bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, sort_order)
);

CREATE INDEX idx_subtasks_task ON subtasks (task_id, sort_order);
```

### 2.10 task_dependencies (DAG edges)

Semantic: `task_id` **depends on** `depends_on_task_id` (edge direction for algorithms: predecessor → `task_id`).

```sql
CREATE TABLE task_dependencies (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id             uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  task_id              uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id   uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (task_id <> depends_on_task_id),
  UNIQUE (task_id, depends_on_task_id)
);

CREATE INDEX idx_task_deps_task ON task_dependencies (board_id, task_id);
CREATE INDEX idx_task_deps_pred ON task_dependencies (board_id, depends_on_task_id);
```

### 2.11 agent_jobs

```sql
CREATE TABLE agent_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            agent_job_type NOT NULL,
  status          agent_job_status NOT NULL DEFAULT 'PENDING',
  board_id        uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trigger_event   text NOT NULL,
  attempt         int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 3,
  idempotency_key text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  result          jsonb,
  last_error      text,
  scheduled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE INDEX idx_agent_jobs_board_status ON agent_jobs (board_id, status);
CREATE INDEX idx_agent_jobs_type_created ON agent_jobs (type, created_at DESC);
```

### 2.12 agent_suggestions

```sql
CREATE TABLE agent_suggestions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id       uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  job_id         uuid REFERENCES agent_jobs(id) ON DELETE SET NULL,
  task_id        uuid REFERENCES tasks(id) ON DELETE SET NULL,
  agent_name     text NOT NULL,
  kind           text NOT NULL,
  status         suggestion_status NOT NULL DEFAULT 'PENDING',
  confidence     double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reasoning      text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);

CREATE INDEX idx_agent_suggestions_board_status ON agent_suggestions (board_id, status, created_at DESC);
CREATE INDEX idx_agent_suggestions_task ON agent_suggestions (task_id);
```

### 2.13 audit_log

```sql
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  board_id     uuid REFERENCES boards(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  mutation_id  uuid,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_board_created ON audit_log (board_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);
```

---

## 3. pgvector — Task Embeddings (RAG)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE task_embeddings (
  task_id     uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  board_id    uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  embedding   vector(1536) NOT NULL,
  model       text NOT NULL,
  content_hash text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_embeddings_board ON task_embeddings (board_id);

-- IVF index after bulk load; lists tuned per data volume
CREATE INDEX idx_task_embeddings_vector ON task_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

**Notes**

- Dimension **1536** is illustrative (OpenAI-style); align with Anthropic companion embedding model if used, or unified embed pipeline.
- Refresh `content_hash` on title/description change; async worker embeds.

---

## 4. Velocity / Analytics (optional normalisation)

```sql
CREATE TABLE sprint_velocity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id   uuid NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  board_id    uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  completed_points int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sprint_id)
);

CREATE INDEX idx_velocity_board ON sprint_velocity (board_id, created_at DESC);
```

---

## 5. Index Strategy Summary

| Pattern | Example | Purpose |
|---------|---------|---------|
| Composite `(board_id, column_id, sort_order)` | Partial `deleted_at IS NULL` | Virtual list hot path |
| Partial status | `WHERE status = 'IN_PROGRESS'` optional | WIP dashboards |
| GIN | `to_tsvector` on description (future) | Search |
| ivfflat | embeddings | RAG similarity |

---

## 6. Soft Delete

- `tasks.deleted_at`, `boards.deleted_at` — all queries default filter `deleted_at IS NULL`.
- **FK behaviour:** dependencies CASCADE when task hard-deleted; soft-delete keeps edges until purge job runs.

---

## 7. Optimistic Locking

Client sends `If-Match: <version>` or body `beforeVersion`. Server:

```sql
UPDATE tasks
SET column_id = $1, sort_order = $2, version = version + 1, updated_at = now()
WHERE id = $3 AND version = $4 AND deleted_at IS NULL;
```

If `rowsAffected == 0` → **409 Conflict**.

---

## 8. Migration Strategy (golang-migrate)

1. Store migrations in `infra/migrations/` as `000001_init.up.sql` / `.down.sql`.
2. CI applies against ephemeral DB; prod with maintenance window or expand/contract for breaking changes.
3. **pgvector:** enable extension in first migration; index creation in separate migration post-backfill.
4. For large boards, add concurrent indexes: `CREATE INDEX CONCURRENTLY` in manual ops migration.

---

## 9. Referential Integrity Notes

- `columns.status` aligns with Kanban column semantics but tasks carry their own `status` — enforce consistency in application on move.
- Cycle detection strictly in API before `INSERT` into `task_dependencies`.

This schema aligns with [`api-contracts.md`](./api-contracts.md) and agent persistence in [`lld.md`](./lld.md).
