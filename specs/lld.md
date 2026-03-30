# FlowTask AI — Low-Level Design (LLD)

This document defines core Go types, the agent contract, job state machine, per-agent internals, optimistic update protocol, Zustand slices, Next.js structure, SSE lifecycle, and error handling.

---

## 1. Go Struct Definitions

All fields use JSON tags matching API contracts unless noted. UUIDs as `string` or `github.com/google/uuid.UUID` in implementation.

### 1.1 Task

```go
type TaskPriority int

const (
	PriorityNone TaskPriority = iota
	PriorityLow
	PriorityMedium
	PriorityHigh
	PriorityUrgent
)

type TaskStatus string

const (
	StatusBacklog     TaskStatus = "BACKLOG"
	StatusTodo        TaskStatus = "TODO"
	StatusInProgress  TaskStatus = "IN_PROGRESS"
	StatusBlocked     TaskStatus = "BLOCKED"
	StatusInReview    TaskStatus = "IN_REVIEW"
	StatusDone        TaskStatus = "DONE"
)

type Task struct {
	ID             string         `json:"id"`
	BoardID        string         `json:"boardId"`
	ColumnID       string         `json:"columnId"`
	SprintID       *string        `json:"sprintId,omitempty"`
	Title          string         `json:"title"`
	Description    string         `json:"description"`
	Status         TaskStatus     `json:"status"`
	Priority       TaskPriority   `json:"priority"`
	TriageScore    *float64       `json:"triageScore,omitempty"`
	AssigneeUserID *string        `json:"assigneeUserId,omitempty"`
	DueDate        *time.Time     `json:"dueDate,omitempty"`
	Labels         []string       `json:"labels"`
	StoryPoints    *int           `json:"storyPoints,omitempty"`
	Subtasks       []Subtask      `json:"subtasks"`
	SortOrder      int64          `json:"sortOrder"`
	Version        int64          `json:"version"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
	DeletedAt      *time.Time     `json:"deletedAt,omitempty"`
}
```

### 1.2 Subtask (embedded shape)

```go
type Subtask struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Completed bool   `json:"completed"`
	SortOrder int64  `json:"sortOrder"`
}
```

### 1.3 Board

```go
type Board struct {
	ID             string    `json:"id"`
	WorkspaceID    string    `json:"workspaceId"`
	Name           string    `json:"name"`
	DefaultSprintW int       `json:"defaultSprintWeeks"`
	EventSeq       int64     `json:"eventSeq"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
	DeletedAt      *time.Time `json:"deletedAt,omitempty"`
}
```

### 1.4 Column

```go
type Column struct {
	ID        string    `json:"id"`
	BoardID   string    `json:"boardId"`
	Name      string    `json:"name"`
	Status    TaskStatus `json:"status"`
	Position  int       `json:"position"`
	WIPLimit  *int      `json:"wipLimit,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}
```

### 1.5 User

```go
type User struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"displayName"`
	AvatarURL   *string   `json:"avatarUrl,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}
```

### 1.6 AgentJob

```go
type AgentJobType string

const (
	JobTriage   AgentJobType = "TRIAGE"
	JobBlocker  AgentJobType = "BLOCKER"
	JobBalancer AgentJobType = "BALANCER"
)

type AgentJobStatus string

const (
	JobPending    AgentJobStatus = "PENDING"
	JobRunning    AgentJobStatus = "RUNNING"
	JobCompleted  AgentJobStatus = "COMPLETED"
	JobFailed     AgentJobStatus = "FAILED"
	JobRetrying   AgentJobStatus = "RETRYING"
	JobDeadLetter AgentJobStatus = "DEAD_LETTER"
)

type AgentJob struct {
	ID            string         `json:"id"`
	Type          AgentJobType   `json:"type"`
	Status        AgentJobStatus `json:"status"`
	BoardID       string         `json:"boardId"`
	WorkspaceID   string         `json:"workspaceId"`
	TriggerEvent  string         `json:"triggerEvent"`
	Attempt       int            `json:"attempt"`
	MaxAttempts   int            `json:"maxAttempts"`
	IdempotencyKey string        `json:"idempotencyKey"`
	Payload       AgentPayload   `json:"payload"`
	Result        *AgentResult   `json:"result,omitempty"`
	LastError     *string        `json:"lastError,omitempty"`
	ScheduledAt   *time.Time     `json:"scheduledAt,omitempty"`
	CreatedAt     time.Time      `json:"createdAt"`
	UpdatedAt     time.Time      `json:"updatedAt"`
}
```

### 1.7 AgentMeta

```go
type AgentMeta struct {
	Name            string    `json:"name"`
	Model           string    `json:"model"`
	PromptVersion   string    `json:"promptVersion"`
	ToolSchemaVersion string  `json:"toolSchemaVersion"`
	StartedAt       time.Time `json:"startedAt"`
	FinishedAt      *time.Time `json:"finishedAt,omitempty"`
	TokensIn        int       `json:"tokensIn"`
	TokensOut       int       `json:"tokensOut"`
}
```

### 1.8 AgentPayload

```go
type AgentPayload struct {
	TaskID    *string                `json:"taskId,omitempty"`
	SprintID  *string                `json:"sprintId,omitempty"`
	UserID    *string                `json:"userId,omitempty"`
	MutationID *string               `json:"mutationId,omitempty"`
	Extra     map[string]interface{} `json:"extra,omitempty"`
}
```

### 1.9 AgentResult

```go
type AgentSuggestionKind string

const (
	SuggestionPriority   AgentSuggestionKind = "PRIORITY"
	SuggestionAssignee AgentSuggestionKind = "ASSIGNEE"
	SuggestionBlocker  AgentSuggestionKind = "BLOCKER"
	SuggestionReassign AgentSuggestionKind = "REASSIGN"
)

type AgentResult struct {
	Meta            AgentMeta              `json:"meta"`
	Confidence      float64                `json:"confidence"`
	Kind            AgentSuggestionKind    `json:"kind"`
	SummaryReason   string                 `json:"summaryReason"`
	StructuredPayload map[string]interface{} `json:"structuredPayload"`
	AutoApplied     bool                   `json:"autoApplied"`
	SuggestionID    *string                `json:"suggestionId,omitempty"`
}
```

### 1.10 StateMutation (command side-car)

```go
type StateMutation struct {
	MutationID   string    `json:"mutationId"`
	BoardID      string    `json:"boardId"`
	UserID       string    `json:"userId"`
	VersionAfter int64     `json:"versionAfter"`
	SeqAfter     int64     `json:"seqAfter"`
	AppliedAt    time.Time `json:"appliedAt"`
}
```

---

## 2. Agent Interface Definition

```go
type Agent interface {
	Name() string
	Run(ctx context.Context, job AgentJob) (AgentResult, error)
	Rollback(ctx context.Context, job AgentJob, result AgentResult) error
}
```

**Semantics**

- `Run` executes synchronously within consumer goroutine; must respect context cancellation.
- `Rollback` invoked when auto-applied mutation must revert (rare — e.g. Balancer mis-assignment detected by guard); idempotent.

---

## 3. Agent Job State Machine

### 3.1 States

`PENDING → RUNNING → COMPLETED` (terminal success)

`PENDING → RUNNING → FAILED → RETRYING → RUNNING` (loop)

After `attempt == maxAttempts` (default **3**): `FAILED → DEAD_LETTER`

### 3.2 Transition rules

| From | Event | To | Guard / side effect |
|------|-------|-----|---------------------|
| — | Job enqueued | `PENDING` | Persist row; dedupe on `idempotencyKey` |
| `PENDING` | Worker acquires lease | `RUNNING` | `UPDATED_AT` bump; lease token in Redis optional |
| `RUNNING` | Success | `COMPLETED` | Write `AgentResult`; emit Kafka `agent.results` |
| `RUNNING` | Retryable error | `RETRYING` | `attempt++`; backoff schedule |
| `RETRYING` | Backoff elapsed | `RUNNING` | Consumer redelivery |
| `RUNNING` | Non-retryable / max attempts | `DEAD_LETTER` | Publish to `flowtaskai.dlq.agent`; alert |

**Retryable:** HTTP 429, 5xx from Claude, transient DB errors.

**Non-retryable:** 400 from Claude, schema validation failure, workspace not found.

---

## 4. Concrete Agents — Internal Design

### 4.1 TriageAgent

**Trigger:** `TASK_CREATED` or move to **Backlog** (`STATUS_CHANGED`).

**Steps**

1. Load task + board context + RAG neighbours (pgvector).
2. Build prompt (see `agents.md`).
3. Call Claude with tools: `get_task_context`, `update_task_priority` (writes **suggestion** not direct apply unless policy says otherwise).
4. Compute `confidence` from model self-rating + heuristic agreement.
5. Insert `agent_suggestions` row; emit SSE `AGENT_SUGGESTION`.
6. Update in-memory **max-heap** mirror (optional) or let next query sort by score.

**Priority heap:** On accepted suggestion, apply PATCH that sets `priority` + `triageScore` and re-heap.

**Rollback:** Remove pending triage suggestion row if job marked invalid.

### 4.2 BlockerAgent

**Trigger:** `STATUS_CHANGED`, dependency graph mutations.

**Steps**

1. Load DAG for `boardId`.
2. Kahn topo; abort event if cycle (should not happen) → DLQ + alert.
3. DP longest path (`dsa.md`); compute set `criticalPathIDs`.
4. For moved-to-BLOCKED tasks, evaluate chain length impact: if **path length > threshold** (e.g. > 2 weighted hops) → `BLOCKER_DETECTED`.
5. Persist `critical_path_snapshot jsonb` optional for fast GET.
6. Tool `flag_blocker` records structured chain for feed.

**Output:** SSE `BLOCKER_DETECTED`, optional `TASK_BLOCKED` sync; notification fan.

**Rollback:** N/A mostly; suggestions are informational. If auto-flag incorrect, human dismiss clears UI state.

### 4.3 BalancerAgent

**Trigger:** `SPRINT_STARTED` cron (Kafka `flowtaskai.sched.balancer`) + manual sprint start.

**Steps**

1. Load active sprint tasks + assignee load counts.
2. Claude proposes reassignments with reasoning.
3. For each proposal:
   - If `confidence > 0.85` → **auto-apply** PATCH assignee + audit + `AGENT_APPLIED` SSE.
   - Else → suggestion card with Accept/Dismiss.
4. Record velocity baseline row at sprint start.

**Rollback:** `Rollback` reverses assignee to prior value from job snapshot.

---

## 5. Confidence Threshold Logic

| Agent action | Condition | UX |
|--------------|-----------|-----|
| Balancer reassignment | `confidence > 0.85` | Auto-apply + feed entry |
| Balancer reassignment | `0.55 < confidence ≤ 0.85` | Suggest |
| Balancer | `≤ 0.55` | Suppress or “low confidence” collapsed |
| Triage priority | Always | Suggest (avoid autonomous priority fights) — *configurable* |
| Blocker highlight | `impactScore > threshold` | Auto notify + highlight |

`impactScore` derived from DP path length, story points sum, sprint proximity.

---

## 6. Optimistic Update Protocol

### 6.1 Client-generated `mutationId`

UUID v4 per drag or form submit.

### 6.2 Sequence

1. Client updates Zustand: `boardSlice.optimisticMove({ taskId, toColumnId, mutationId })`.
2. `PATCH /api/v1/tasks/:id/move` with body `{ columnId, sortOrder, beforeVersion, mutationId }`.
3. On **200**: wait for SSE with same `mutationId` or matching `seq`; reconcile version.
4. On **409**: rollback optimistic state from response `task` entity; toast conflict.
5. On **network error**: retry idempotent POST with same `mutationId`.

Server includes `mutationId` echo in SSE payloads for correlation.

---

## 7. Zustand Store Slices

### 7.1 boardSlice

```typescript
type BoardSliceState = {
  boardId: string | null;
  columns: ColumnDTO[];
  tasksById: Record<string, TaskDTO>;
  columnTaskIds: Record<string, string[]>;
  depsByTaskId: Record<string, { successors: string[]; predecessors: string[] }>;
  eventSeq: number;
  pendingMutations: Map<string, PendingMutation>;
  criticalPathTaskIds: Set<string>;
};

type BoardSliceActions = {
  hydrateFromSnapshot: (snap: BoardSnapshotDTO) => void;
  applySSEEvent: (evt: SSEEventDTO) => void;
  optimisticMove: (args: {
    taskId: string;
    toColumnId: string;
    sortOrder: number;
    mutationId: string;
  }) => void;
  rollbackMutation: (mutationId: string) => void;
};
```

### 7.2 agentSlice

```typescript
type AgentFeedEntry = {
  id: string;
  agentName: string;
  action: string;
  taskId?: string;
  reasoning: string;
  confidence: number;
  createdAt: string;
  suggestionId?: string;
  kind: 'INFO' | 'SUGGESTION' | 'AUTO_APPLIED';
};

type AgentSliceState = {
  feed: AgentFeedEntry[];
  suggestionsById: Record<string, AgentSuggestionDTO>;
};

type AgentSliceActions = {
  prependFeed: (entry: AgentFeedEntry) => void;
  resolveSuggestion: (id: string, status: 'ACCEPTED' | 'DISMISSED') => void;
};
```

### 7.3 uiSlice

```typescript
type UiSliceState = {
  activityPanelOpen: boolean;
  columnWidthsById: Record<string, number>;
  selectedTaskId: string | null;
  dragPreview: { taskId: string } | null;
  toasts: Toast[];
};

type UiSliceActions = {
  toggleActivityPanel: () => void;
  selectTask: (id: string | null) => void;
  pushToast: (t: Toast) => void;
};
```

**Middleware:** `devtools` in dev only; **persist** only `activityPanelOpen` and `columnWidthsById` (see `ui.md`).

**Selector memoization:** use `useShallow` from `zustand/react/shallow` for object picks; use `reselect` `createSelector` for critical-path derivation keyed by `depsVersion` / `tasks` fingerprint.

---

## 8. Next.js App Router Structure

| Path | `layout.tsx` | `page.tsx` | `loading.tsx` | `error.tsx` |
|------|--------------|------------|---------------|-------------|
| `/` | Root layout (fonts, providers) | Marketing redirect → `/app` | skeleton | global error |
| `(auth)/login` | auth minimal layout | login page | — | — |
| `(dashboard)/app` | dashboard shell + sidebar | workspace overview | skeleton | segment error |
| `(dashboard)/app/w/[workspaceId]/boards` | workspace layout | board list | skeleton | — |
| `(dashboard)/app/w/[workspaceId]/b/[boardId]` | board layout | Kanban board | board skeleton | board error boundary |

**Providers order:** `QueryClientProvider` → `ZustandProvider` (if used) → `DndContext` scoped to board page.

---

## 9. SSE Connection Lifecycle

### 9.1 Connect

`useSSE(boardId)` opens `EventSource` or `fetch` ReadableStream (if custom headers needed).

- On open: optional `GET /boards/:id` snapshot if first load.
- Store `lastSeq` from `BOARD_SNAPSHOT` / last event.

### 9.2 Heartbeat

Ignore comment events; use to refresh connection staleness timer.

### 9.3 Reconnect with `last-event-id`

On error/close:

1. Exponential backoff (max 30s).
2. Reconnect with header `Last-Event-ID: <lastSeq>` or query.
3. If server returns snapshot first, replace state; else apply delta events in order.

### 9.4 Cleanup

Abort controller on route unmount; clear timers.

---

## 10. Error Boundary Strategy

| Layer | Mechanism |
|-------|-----------|
| **Route** | `error.tsx` per segment; reset button calls `router.refresh()` |
| **Board critical subtree** | React error boundary wrapping virtualised columns — failure falls back to “compact list” mode message |
| **Global** | Root `GlobalError` for top-level fatals |
| **Data fetching** | TanStack Query `throwOnError` false; map errors to toasts + inline |
| **Forms** | `react-hook-form` field errors + Zod |

**Logging:** Send boundary errors to observability with `boardId`, `userId`, `buildId`.

---

## Related Documents

- [`api-contracts.md`](./api-contracts.md) — wire types for DTOs above  
- [`agents.md`](./agents.md) — prompts and tools  
- [`ui.md`](./ui.md) — component tree and hooks detail  
