# FlowTask AI — API Contracts

Base URL: `https://api.example.com`. Version prefix: `/api/v1`.

**Authentication:** `Authorization: Bearer <access_token>` on all endpoints unless noted.

**Common headers**

| Header | When |
|--------|------|
| `Idempotency-Key` | Recommended on all `POST` commands |
| `If-Match` | Optional; carries task `version` for optimistic locking |

**Error envelope**

```typescript
interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

| HTTP | `code` examples |
|------|-----------------|
| 400 | `VALIDATION_ERROR`, `INVALID_DEPENDENCY_CYCLE` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `VERSION_CONFLICT`, `INVALID_STATE_TRANSITION` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |

---

## Commands (Write)

### POST `/api/v1/boards`

**Auth:** Member+ of workspace.

**Request**

```typescript
interface CreateBoardRequest {
  workspaceId: string;
  name: string;
  defaultSprintWeeks: 1 | 2;
}
```

**Response 201**

```typescript
interface CreateBoardResponse {
  board: BoardDTO;
  columns: ColumnDTO[];
}
```

**Errors:** 400, 403, 404 (`workspaceId`).

---

### POST `/api/v1/boards/:boardId/columns`

**Auth:** Admin+ or board manage.

**Request**

```typescript
interface CreateColumnRequest {
  name: string;
  status: TaskStatus;
  position: number;
  wipLimit?: number | null;
}
```

**Response 201**

```typescript
interface CreateColumnResponse {
  column: ColumnDTO;
}
```

---

### POST `/api/v1/tasks`

**Auth:** `can_create_tasks`.

**Request**

```typescript
interface CreateTaskRequest {
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  labels?: string[];
  storyPoints?: number | null;
  sprintId?: string | null;
  sortOrder: number;
  mutationId?: string;
}
```

**Response 201**

```typescript
interface CreateTaskResponse {
  task: TaskDTO;
  mutation: StateMutationDTO;
}
```

---

### PATCH `/api/v1/tasks/:taskId`

**Auth:** Member+ with board access.

**Request**

```typescript
interface PatchTaskRequest {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  labels?: string[];
  storyPoints?: number | null;
  sprintId?: string | null;
  beforeVersion: number;
  mutationId?: string;
}
```

**Response 200**

```typescript
interface PatchTaskResponse {
  task: TaskDTO;
  mutation: StateMutationDTO;
}
```

**Errors:** 409 on version conflict.

---

### PATCH `/api/v1/tasks/:taskId/move`

**Auth:** Member+.

**Request**

```typescript
interface MoveTaskRequest {
  columnId: string;
  sortOrder: number;
  beforeVersion: number;
  mutationId: string;
}
```

**Response 200**

```typescript
interface MoveTaskResponse {
  task: TaskDTO;
  mutation: StateMutationDTO;
}
```

**Errors:** 409 conflict; 400 invalid column/status.

---

### POST `/api/v1/tasks/:taskId/dependencies`

**Auth:** Member+.

**Request**

```typescript
interface AddDependencyRequest {
  dependsOnTaskId: string;
}
```

**Response 201**

```typescript
interface AddDependencyResponse {
  dependency: {
    id: string;
    taskId: string;
    dependsOnTaskId: string;
  };
}
```

**Errors:** 400 `INVALID_DEPENDENCY_CYCLE`.

---

### DELETE `/api/v1/tasks/:taskId/dependencies/:depId`

**Auth:** Member+.

**Response 204** empty.

---

### POST `/api/v1/suggestions/:suggestionId/accept`

**Auth:** Member+.

**Request**

```typescript
interface AcceptSuggestionRequest {
  mutationId?: string;
}
```

**Response 200**

```typescript
interface AcceptSuggestionResponse {
  suggestion: AgentSuggestionDTO;
  task?: TaskDTO;
  mutation: StateMutationDTO;
}
```

---

### POST `/api/v1/suggestions/:suggestionId/dismiss`

**Auth:** Member+.

**Request**

```typescript
interface DismissSuggestionRequest {
  reason?: string;
}
```

**Response 200**

```typescript
interface DismissSuggestionResponse {
  suggestion: AgentSuggestionDTO;
}
```

---

### POST `/api/v1/sprints`

**Auth:** Admin+.

**Request**

```typescript
interface CreateSprintRequest {
  boardId: string;
  name: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
}
```

**Response 201**

```typescript
interface CreateSprintResponse {
  sprint: SprintDTO;
}
```

---

### POST `/api/v1/sprints/:sprintId/start`

**Auth:** Admin+.

**Request**

```typescript
interface StartSprintRequest {
  mutationId?: string;
}
```

**Response 200**

```typescript
interface StartSprintResponse {
  sprint: SprintDTO;
  mutation: StateMutationDTO;
}
```

---

## Queries (Read)

### GET `/api/v1/boards/:boardId`

**Auth:** Viewer+.

**Response 200**

```typescript
interface GetBoardResponse {
  board: BoardDTO;
  columns: ColumnDTO[];
  activeSprint?: SprintDTO | null;
  eventSeq: number;
}
```

---

### GET `/api/v1/boards/:boardId/tasks`

**Auth:** Viewer+.

**Query params**

| Param | Description |
|-------|-------------|
| `columnId` | Filter |
| `sprintId` | Filter |
| `limit` / `cursor` | Keyset pagination |

**Response 200**

```typescript
interface ListTasksResponse {
  tasks: TaskDTO[];
  nextCursor?: string | null;
}
```

---

### GET `/api/v1/tasks/:taskId/critical-path`

**Auth:** Viewer+.

**Response 200**

```typescript
interface CriticalPathResponse {
  taskId: string;
  boardId: string;
  criticalPathTaskIds: string[];
  lengthsByTaskId: Record<string, number>;
}
```

---

### GET `/api/v1/workspaces/:workspaceId/boards`

**Auth:** Member+.

**Response 200**

```typescript
interface ListBoardsResponse {
  boards: BoardDTO[];
}
```

---

### GET `/api/v1/sprints/:sprintId/velocity`

**Auth:** Viewer+.

**Response 200**

```typescript
interface SprintVelocityResponse {
  sprintId: string;
  completedPoints: number;
  history: Array<{ sprintId: string; completedPoints: number }>;
}
```

---

## Shared DTOs

```typescript
type TaskStatus =
  | 'BACKLOG'
  | 'TODO'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'IN_REVIEW'
  | 'DONE';

type TaskPriority = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

interface BoardDTO {
  id: string;
  workspaceId: string;
  name: string;
  defaultSprintWeeks: 1 | 2;
  createdAt: string;
  updatedAt: string;
}

interface ColumnDTO {
  id: string;
  boardId: string;
  name: string;
  status: TaskStatus;
  position: number;
  wipLimit?: number | null;
}

interface TaskDTO {
  id: string;
  boardId: string;
  columnId: string;
  sprintId?: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  triageScore?: number | null;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  labels: string[];
  storyPoints?: number | null;
  subtasks: SubtaskDTO[];
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface SubtaskDTO {
  id: string;
  title: string;
  completed: boolean;
  sortOrder: number;
}

interface SprintDTO {
  id: string;
  boardId: string;
  name: string;
  goal?: string;
  startDate?: string | null;
  endDate?: string | null;
  startedAt?: string | null;
  closedAt?: string | null;
}

interface AgentSuggestionDTO {
  id: string;
  boardId: string;
  taskId?: string | null;
  agentName: string;
  kind: string;
  status: 'PENDING' | 'ACCEPTED' | 'DISMISSED' | 'EXPIRED';
  confidence: number;
  reasoning: string;
  payload: Record<string, unknown>;
  createdAt: string;
  resolvedAt?: string | null;
}

interface StateMutationDTO {
  mutationId: string;
  boardId: string;
  userId: string;
  versionAfter: number;
  seqAfter: number;
  appliedAt: string;
}
```

---

## Streaming: GET `/api/v1/boards/:boardId/stream`

**Auth:** Viewer+.

**Headers (client):**

- `Accept: text/event-stream`
- `Last-Event-ID` optional: last processed `seq` as string

**Event wire format**

```text
id: 184290
event: TASK_MOVED
data: {"seq":184290,"type":"TASK_MOVED","boardId":"...","payload":{...}}

```

### Event types and payload shapes

#### `BOARD_SNAPSHOT`

```typescript
interface BoardSnapshotEvent {
  seq: number;
  type: 'BOARD_SNAPSHOT';
  boardId: string;
  ts: string;
  payload: {
    board: BoardDTO;
    columns: ColumnDTO[];
    tasks: TaskDTO[];
    dependencies: Array<{ id: string; taskId: string; dependsOnTaskId: string }>;
    criticalPathTaskIds: string[];
    eventSeq: number;
  };
}
```

#### `TASK_CREATED`

```typescript
interface TaskCreatedEvent {
  seq: number;
  type: 'TASK_CREATED';
  boardId: string;
  ts: string;
  payload: {
    task: TaskDTO;
    mutationId?: string;
  };
}
```

#### `TASK_MOVED`

```typescript
interface TaskMovedEvent {
  seq: number;
  type: 'TASK_MOVED';
  boardId: string;
  ts: string;
  payload: {
    task: TaskDTO;
    mutationId: string;
  };
}
```

#### `TASK_UPDATED`

```typescript
interface TaskUpdatedEvent {
  seq: number;
  type: 'TASK_UPDATED';
  boardId: string;
  ts: string;
  payload: {
    task: TaskDTO;
    mutationId?: string;
  };
}
```

#### `TASK_BLOCKED`

```typescript
interface TaskBlockedEvent {
  seq: number;
  type: 'TASK_BLOCKED';
  boardId: string;
  ts: string;
  payload: {
    task: TaskDTO;
    reason?: string;
    mutationId?: string;
  };
}
```

#### `BLOCKER_DETECTED`

```typescript
interface BlockerDetectedEvent {
  seq: number;
  type: 'BLOCKER_DETECTED';
  boardId: string;
  ts: string;
  payload: {
    anchorTaskId: string;
    chainTaskIds: string[];
    chainTitles: string[];
    impactScore: number;
    criticalPathLength: number;
  };
}
```

#### `AGENT_SUGGESTION`

```typescript
interface AgentSuggestionEvent {
  seq: number;
  type: 'AGENT_SUGGESTION';
  boardId: string;
  ts: string;
  payload: {
    suggestion: AgentSuggestionDTO;
  };
}
```

#### `AGENT_APPLIED`

```typescript
interface AgentAppliedEvent {
  seq: number;
  type: 'AGENT_APPLIED';
  boardId: string;
  ts: string;
  payload: {
    suggestionId: string;
    agentName: string;
    task?: TaskDTO;
    summary: string;
    confidence: number;
  };
}
```

#### `SPRINT_STARTED`

```typescript
interface SprintStartedEvent {
  seq: number;
  type: 'SPRINT_STARTED';
  boardId: string;
  ts: string;
  payload: {
    sprint: SprintDTO;
    mutationId?: string;
  };
}
```

#### `heartbeat`

Comment frames only (`: ping`); no JSON payload.

---

## Auth requirement summary

| Endpoint | Minimum role |
|----------|----------------|
| Workspace boards list | Member |
| Board read / stream / tasks | Viewer |
| Create task / move / patch | Member w/ capability |
| Sprint create/start | Admin |
| Manage columns | Admin / Owner |
| Accept/dismiss suggestion | Member |

---

## CORS / SSE

- API must allow credentialed CORS from web origin if cookie session used.
- SSE: disable buffering on reverse proxy (`X-Accel-Buffering: no`) for nginx.

See [`hld.md`](./hld.md) for fan-out mechanics.
