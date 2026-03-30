# FlowTask AI — Agent Architecture

This document specifies the Go agent interface contract, Kafka orchestration, prompt templates, Claude tool definitions (JSON Schema), streaming to SSE, confidence policies, DLQ handling, and the TriageAgent RAG pipeline.

---

## 1. Agent Interface Contract (Go)

```go
package agents

import (
	"context"
	"time"
)

type AgentJobType string

type AgentJobStatus string

type AgentPayload struct {
	TaskID     *string
	SprintID   *string
	UserID     *string
	MutationID *string
	Extra      map[string]interface{}
}

// AgentJob mirrors specs/lld.md §1.6 (full enum constants in implementation).
type AgentJob struct {
	ID             string
	Type           AgentJobType
	Status         AgentJobStatus
	BoardID        string
	WorkspaceID    string
	TriggerEvent   string
	Attempt        int
	MaxAttempts    int
	IdempotencyKey string
	Payload        AgentPayload
	Result         *AgentResult
	LastError      *string
	ScheduledAt    *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type AgentMeta struct {
	Name              string
	Model             string
	PromptVersion     string
	ToolSchemaVersion string
	StartedAt         time.Time
	FinishedAt        *time.Time
	TokensIn          int
	TokensOut         int
}

type AgentSuggestionKind string

type AgentResult struct {
	Meta              AgentMeta
	Confidence        float64
	Kind              AgentSuggestionKind
	SummaryReason     string
	StructuredPayload map[string]interface{}
	AutoApplied       bool
	SuggestionID      *string
}

type Agent interface {
	Name() string
	Run(ctx context.Context, job AgentJob) (AgentResult, error)
	Rollback(ctx context.Context, job AgentJob, result AgentResult) error
}
```

**Orchestrator responsibilities**

- Parse Kafka record → `AgentJob` with dedupe key.
- Select implementation by `job.Type`.
- Invoke `Run` under timeout (e.g. 60s model + 20s tools).
- Persist result / suggestion; publish SSE-related follow-up via query broadcaster.
- On fatal failure, transition job to DLQ per [`lld.md`](./lld.md).

---

## 2. Orchestrator Design — Kafka → Agent Selection

```text
Kafka record (domain.event)
        │
        ▼
┌───────────────────┐
│ Router / consumer  │  map: event.type → []AgentJobType
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
 Triage      Blocker     Balancer
 consumer    consumer    consumer
```

**Trigger table**

| Domain event | Agents enqueued |
|--------------|-----------------|
| `TASK_CREATED` | Triage |
| `TASK_MOVED` to Backlog column | Triage |
| `STATUS_CHANGED` | Blocker |
| `DEPENDENCY_UPSERTED` / `DEPENDENCY_REMOVED` | Blocker |
| `SPRINT_STARTED` | Balancer |
| `SCHED_BALANCER_TICK` (every 30 min) | Balancer |

**Idempotency:** `idempotencyKey = hash(boardId, taskId?, eventId, agentType)`.

**Fan-in control:** Per-board sliding window rate limit (`dsa.md`) before enqueue.

---

## 3. Prompt Templates

Placeholders use `{{variable}}`. All agents receive **JSON context** block first.

### 3.1 TriageAgent — System prompt

```text
You are FlowTask AI Triage, an autonomous project-management agent. You optimize backlog ordering and staffing suggestions for a Kanban board. You NEVER invent tasks. You ONLY use provided context and tools. Output must be concise and actionable. When uncertain, lower your confidence. Prefer stable priorities over large swings. Respect workplace inclusivity: never evaluate people, only workload and task characteristics.
```

### 3.2 TriageAgent — User prompt structure

```text
Context (JSON):
{{board_json}}

Task under triage:
{{task_json}}

Similar historical tasks (RAG):
{{rag_hits_json}}

Team workload snapshot:
{{workload_json}}

Instructions:
1. Call get_task_context if any field seems incomplete.
2. Propose a priority score 0.0–1.0 and mapped enum (NONE, LOW, MEDIUM, HIGH, URGENT) consistent with board norms.
3. Suggest assignee ONLY from active members list; if none suitable, omit assignee.
4. Call update_task_priority tool with reasoning and confidence.
5. Respond with a one-sentence summary.
```

### 3.3 BlockerAgent — System prompt

```text
You are FlowTask AI Blocker, responsible for dependency risk. You analyse DAG context and already-computed metrics. You MUST NOT modify tasks except via flag_blocker tool for surfacing alerts. Use precise language. Highlight critical paths conservatively.
```

### 3.4 BlockerAgent — User prompt structure

```text
DAG summary:
{{dag_summary_json}}

Topological order (ids):
{{topo_order_json}}

DP critical path lengths:
{{dp_lengths_json}}

Changed task:
{{task_json}}

Recent status transition:
{{transition_json}}

Instructions:
1. Confirm whether the change introduces a high-impact blocker using threshold {{impact_threshold}}.
2. If yes, call flag_blocker with ordered chain of task IDs and human-readable titles.
3. Otherwise respond NO_BLOCKER with short rationale.
```

### 3.5 BalancerAgent — System prompt

```text
You are FlowTask AI Balancer. You redistribute sprint work to reduce overload while respecting skills only when explicitly tagged on tasks (labels). Never move tasks to users outside the workspace member list. You must output reassignment proposals with reasoning. High certainty allows automatic application by the system; be calibration-aware.
```

### 3.6 BalancerAgent — User prompt structure

```text
Sprint:
{{sprint_json}}

Tasks in sprint:
{{sprint_tasks_json}}

Assignee load:
{{load_json}}

Thresholds:
max_tasks_per_assignee={{threshold}}

Instructions:
1. Identify overloaded assignees.
2. Propose moves that preserve dependency feasibility (do not propose impossible parallelisation).
3. For each proposal call reassign_task tool with fromUserId, toUserId, taskId, reason, confidence.
4. Limit proposals to 10.
```

---

## 4. Tool Definitions (Claude Tool Use — JSON Schema)

### 4.1 `get_task_context`

**Description:** Load normalised task detail (server fills from DB).

```json
{
  "name": "get_task_context",
  "description": "Fetch authoritative task fields and dependency neighbours.",
  "input_schema": {
    "type": "object",
    "properties": {
      "taskId": { "type": "string", "format": "uuid" }
    },
    "required": ["taskId"]
  }
}
```

**Tool result (output to model)**

```json
{
  "task": { },
  "predecessors": [ { "id": "uuid", "title": "string", "status": "TODO" } ],
  "successors": [ ]
}
```

### 4.2 `update_task_priority`

```json
{
  "name": "update_task_priority",
  "description": "Submit triage outcome as a suggestion or direct update (server applies policy).",
  "input_schema": {
    "type": "object",
    "properties": {
      "taskId": { "type": "string", "format": "uuid" },
      "priority": {
        "type": "string",
        "enum": ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]
      },
      "score": { "type": "number", "minimum": 0, "maximum": 1 },
      "suggestedAssigneeUserId": { "type": "string", "format": "uuid" },
      "reasoning": { "type": "string", "maxLength": 2000 },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
    },
    "required": ["taskId", "priority", "score", "reasoning", "confidence"]
  }
}
```

**Server-side effect:** Insert `agent_suggestions` row (`PRIORITY` / `ASSIGNEE`); emit `AGENT_SUGGESTION` SSE.

### 4.3 `flag_blocker`

```json
{
  "name": "flag_blocker",
  "description": "Record a high-impact blocker chain for UI + notifications.",
  "input_schema": {
    "type": "object",
    "properties": {
      "anchorTaskId": { "type": "string", "format": "uuid" },
      "chainTaskIds": {
        "type": "array",
        "items": { "type": "string", "format": "uuid" },
        "minItems": 2,
        "maxItems": 50
      },
      "impactScore": { "type": "number", "minimum": 0, "maximum": 1 },
      "reasoning": { "type": "string" }
    },
    "required": ["anchorTaskId", "chainTaskIds", "impactScore", "reasoning"]
  }
}
```

**Server-side effect:** Persist alert row (optional `blocker_events` table); emit SSE `BLOCKER_DETECTED`; enqueue notification consumer.

### 4.4 `reassign_task`

```json
{
  "name": "reassign_task",
  "description": "Propose or apply assignee change for a task.",
  "input_schema": {
    "type": "object",
    "properties": {
      "taskId": { "type": "string", "format": "uuid" },
      "fromUserId": { "type": "string", "format": "uuid" },
      "toUserId": { "type": "string", "format": "uuid" },
      "reason": { "type": "string" },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
    },
    "required": ["taskId", "fromUserId", "toUserId", "reason", "confidence"]
  }
}
```

**Server-side effect:**

- If `confidence > 0.85`: transactional PATCH assignee + audit + `AGENT_APPLIED` SSE.
- Else: insert suggestion (`REASSIGN`).

---

## 5. Streaming Agent Responses → SSE

1. Claude streaming yields `message_delta` events; tool calls arrive as structured blocks.
2. Orchestrator **does not** stream partial tool results to end users by default (avoids noisy feed).
3. When final tool payload available:
   - Persist DB state.
   - Publish internal `BroadcastCommand` to SSE hub with `seq`.
4. Optional **“thinking”** mode (future): gated feature flag streams interim text to admins only.

---

## 6. Confidence Scoring and Threshold Table

| Agent | Signal | Combination |
|-------|--------|-------------|
| Triage | Model self `confidence` + heuristic: score delta vs historical variance | `final = 0.6*model + 0.4*heuristic` |
| Blocker | `impactScore` from DP path length + story points sum | `final = clamp( linear_map(length, points), 0, 1)` |
| Balancer | Model `confidence` + rule: violates load threshold? | Reduce 0.1 if crosses skill label mismatch |

**Threshold table (production defaults)**

| Action | Auto-apply | Suggest | Suppress |
|--------|------------|---------|----------|
| Balancer reassignment | `> 0.85` | `0.55–0.85` | `< 0.55` |
| Triage priority | Never auto (configurable) | always | — |
| Blocker notification | `impact ≥ 0.7` | `0.4–0.7` silent card | `< 0.4` |

---

## 7. Dead-Letter Queue Handling

**DLQ message schema**

```json
{
  "jobId": "uuid",
  "type": "TRIAGE|BLOCKER|BALANCER",
  "boardId": "uuid",
  "payload": {},
  "error": { "code": "string", "message": "string" },
  "attempts": 3,
  "createdAt": "2026-03-29T00:00:00Z"
}
```

**Operational response**

- Alert on-call channel when DLQ depth > N in 5 minutes.
- **Replay tool:** admin CLI `flowtask-ai agent replay --job-id` moves job to pending after fixing poison data.
- **Manual review UI (future):** Operator sees payload + stack; can “discard” or “requeue”.

---

## 8. RAG Pipeline (TriageAgent)

### 8.1 Chunking

- Unit of embedding: `title + "\n\n" + description` truncated to model max (e.g. 8k chars) with hash `content_hash`.

### 8.2 Embed

- Async worker on `TASK_UPDATED` significant fields → call embedding provider; store `task_embeddings` row (`db-schema.md`).

### 8.3 Retrieve

- Query embedding built from new task same way.
- SQL (conceptual):

```sql
SELECT t.id, t.title, t.description, te.embedding <=> $1 AS distance
FROM task_embeddings te
JOIN tasks t ON t.id = te.task_id
WHERE te.board_id = $2 AND t.deleted_at IS NULL AND t.id <> $3
ORDER BY distance
LIMIT 8;
```

### 8.4 Inject

- Serialize top-k as `rag_hits_json` with fields `id`, `title`, `status`, `completedAt?`, `storyPoints` (no PII beyond task meta).

### 8.5 Safety

- Strip emails/URLs matching blocklist before embed + prompt.

---

## 9. Model Configuration

| Agent | Suggested model | Max tokens | Timeout |
|-------|-----------------|------------|---------|
| Triage | Claude Sonnet | 4096 | 45s |
| Blocker | Claude Sonnet | 2048 | 20s |
| Balancer | Claude Sonnet | 4096 | 45s |

**Tool choice:** `tool_choice: "auto"`.

---

## 10. Testing Strategy (implementation phase)

- **Golden tests** for DAG metrics independent of LLM.
- **Contract tests** for tool JSON against schema.
- **Shadow mode:** compute suggestion but do not persist — compare drift in staging.

This document pairs with [`lld.md`](./lld.md) and [`api-contracts.md`](./api-contracts.md).
