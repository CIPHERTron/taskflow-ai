# FlowTask AI — High-Level Design (HLD)

This document describes the system topology, data flow, Kafka and Redis design, SSE delivery, scaling, failure modes, and back-pressure for the FlowTask AI platform.

---

## 1. Full System Architecture (ASCII)

```text
                          ┌──────────────────────────────────────────────────────────┐
                          │                      Internet / CDN                       │
                          └────────────────────────────┬─────────────────────────────┘
                                                       │
                                                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│  apps/web — Next.js 14 (App Router)                                                         │
│  • Kanban UI (virtualised)   • Zustand + TanStack Query   • Framer Motion / Tailwind       │
│  • SSE client (EventSource / fetch stream)    • Optimistic DnD (dnd-kit)                 │
└───────────────────────────────────────────────┬────────────────────────────────────────┘
                                                HTTPS
                                                REST + SSE
                                                       │
                                                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│  apps/api — Go Fiber (stateless replicas behind load balancer)                             │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌────────────────────────────────┐ │
│  │ Command handlers     │    │ Query handlers       │    │ SSE hub / broadcaster         │ │
│  │ (writes)             │    │ (reads + snapshots)  │    │ per boardId connection map    │ │
│  └──────────┬──────────┘    └──────────┬──────────┘    └───────────────┬────────────────┘ │
│             │                          │                                │                 │
│             │         Shared modules: authz, validation, idempotency, observability       │
└─────────────┼──────────────────────────┼────────────────────────────────┼────────────────┘
              │                          │                                │
              │ PG writes                 │ PG reads + Redis                 │ Redis pub/sub
              ▼                          ▼                                or in-proc fan-out
┌──────────────────────┐    ┌──────────────────────┐    ┌────────────────────────────────┐
│ PostgreSQL (+pgvector)│    │ Redis                 │    │ Kafka cluster                 │
│ • Canonical state     │    │ • Board snapshot LRU  │    │ • Domain events               │
│ • Embeddings for RAG  │    │ • Rate limit counters │    │ • Agent job queue (topics)    │
└──────────────────────┘    │ • Optional job queue  │    └───────────────┬────────────────┘
                            └──────────────────────┘                    │
                                                                        │ consumer groups
                    ┌───────────────────────────────────────────────────┼───────────────────────┐
                    │                                                   │                       │
                    ▼                                                   ▼                       ▼
         ┌────────────────────┐                             ┌────────────────────┐   ┌──────────────────┐
         │ Agent worker pool  │                             │ Query projection   │   │ Notification svc │
         │ • TriageAgent      │                             │ (optional async)   │   │ (email + in-app) │
         │ • BlockerAgent     │                             │                    │   └──────────────────┘
         │ • BalancerAgent    │                             └────────────────────┘
         └─────────┬──────────┘
                   │
                   ▼
         ┌────────────────────┐
         │ Anthropic Claude   │
         │ (tool use + stream)│
         └────────────────────┘
```

**Legend:**

- **Command path:** User mutation → API validation → transactional DB write → Kafka event → (async) side effects.
- **Query path:** Read from PostgreSQL and/or Redis snapshot materialisation; never mutates.
- **SSE path:** API pushes ordered events to subscribed clients per `boardId`; snapshot on connect/reconnect.

---

## 2. CQRS: Command vs Query Service

FlowTask AI uses a **logical CQRS split**. In minimal deployments, both can run in the same `apps/api` binary behind feature flags; in larger deployments they split into `api-command` and `api-query` images.

### 2.1 Command service (write model)

| Aspect | Design |
|--------|--------|
| **Entry** | REST `POST`/`PATCH`/`DELETE` under `/api/v1/...` |
| **Responsibilities** | Validate payloads, enforce RBAC, maintain dependency DAG integrity (cycle checks), optimistic concurrency (`version`), soft-delete invariants |
| **Persistence** | Single PostgreSQL transaction per command; append audit row |
| **Events** | After commit, publish canonical events to Kafka (`flowtaskai.domain.tasks`, etc.) — transactional outbox pattern recommended |
| **Response** | Return 201/200 with `task`, `boardVersion`, `mutationId` for client reconciliation |
| **Never** | Perform LLM calls inline; never block on agents |

### 2.2 Query service (read model)

| Aspect | Design |
|--------|--------|
| **Entry** | REST `GET` + SSE stream |
| **Responsibilities** | Serve board aggregates, task lists, critical-path summaries, velocities |
| **Caching** | Redis LRU key `board:{boardId}:snapshot` holding serialised board + `seq` |
| **Consistency** | Read-your-writes: command responses include entity version; client may refetch snapshot if `seq` gap detected |
| **Never** | Emit Kafka events; never mutate task graph without command |

### 2.3 Event carriers

Commands produce **facts**. Agents consume facts and may emit **agent results** (new Kafka messages or direct API internal calls restricted to agent service accounts). Query side reflects outcomes via same event stream or agent completion webhooks — **spec choice:** agent worker writes suggestion rows in PostgreSQL then publishes `AGENT_SUGGESTION` / `AGENT_APPLIED` to Kafka → query layer broadcasts via SSE.

---

## 3. Kafka Topic Design

### 3.1 Topic naming

Prefix: `flowtaskai.` (environment suffix optional: `.dev`, `.prod`).

| Topic | Purpose |
|-------|---------|
| `flowtaskai.domain.tasks` | Task lifecycle: created, updated, moved, blocked |
| `flowtaskai.domain.dependencies` | Edge added/removed |
| `flowtaskai.domain.sprints` | Sprint created, started, closed |
| `flowtaskai.domain.boards` | Board/column structural changes (lower volume) |
| `flowtaskai.agent.jobs` | Optional explicit agent job envelope (if not derived solely from domain topics) |
| `flowtaskai.agent.results` | Normalised agent output for projection/notifications |
| `flowtaskai.dlq.agent` | Dead-letter for failed agent jobs after retries |

**Partitioning strategy**

| Topic | Partition key | Rationale |
|-------|---------------|-----------|
| `domain.tasks` | `boardId` | All task events for a board ordered per partition; simplifies consumer caching |
| `domain.dependencies` | `boardId` | Co-locate with task stream consumers |
| `domain.sprints` | `boardId` | Sprint scoped to board |
| `agent.jobs` | `boardId` | Sticky agent routing; aligns with consistent hashing workers |
| `agent.results` | `boardId` | SSE fan-out per board |

**Consumer groups**

| Group ID | Subscribers | Notes |
|----------|-------------|-------|
| `flowtaskai-agent-triage` | TriageAgent workers | Filter: `TASK_CREATED`, move to Backlog |
| `flowtaskai-agent-blocker` | BlockerAgent workers | Filter: `STATUS_CHANGED`, dependency changes |
| `flowtaskai-agent-balancer` | BalancerAgent workers | `SPRINT_STARTED` + scheduled tick topic `flowtaskai.sched.balancer` |
| `flowtaskai-projections-query` | Optional async projector | Maintains read models / Redis snapshot warmer |
| `flowtaskai-notifications` | Notification service | Decoupled; at-least-once delivery |

**Ordering guarantees:** Single partition per `boardId` gives per-board total order for task events *if all producers use the same key*. Dependency events must use the same key to avoid cross-partition races.

**Retention:** Domain topics: 7–14 days (prod); longer if audit replay required. DLQ: 30 days.

---

## 4. SSE Event Flow

### 4.1 Connection

- Client: `GET /api/v1/boards/:boardId/stream` with `Authorization` and optional header `Last-Event-ID` (or query `?since_seq=`).
- Server: authenticates, authorises board access, immediately sends `BOARD_SNAPSHOT` (or separate prefetch `GET /boards/:id` + stream from current `seq`).

### 4.2 Event envelope (conceptual)

```json
{
  "seq": 184290,
  "type": "TASK_MOVED",
  "boardId": "uuid",
  "ts": "2026-03-29T12:00:00.000Z",
  "payload": { }
}
```

### 4.3 Mutation → SSE sequence

1. Client issues command with `Idempotency-Key` and receives `mutationId`.
2. Command commits → increment board/event counter (`seq`) in Redis + PostgreSQL (`board_event_seq` table or atomic Redis INCR).
3. Broadcaster publishes SSE to all subscribers for `boardId`.
4. Client waits for event matching `mutationId` or reconciles via snapshot on timeout.

### 4.4 Gap detection

If client observes `seq` jump (missing gap), trigger `GET /api/v1/boards/:boardId` snapshot refresh and optionally re-open SSE with `since_seq=last_known_good`.

### 4.5 Heartbeat

Comment frames every `SSE_HEARTBEAT_INTERVAL` seconds to keep intermediaries from closing idle connections.

---

## 5. Redis Usage

### 5.1 LRU board snapshot cache

| Key | Type | Value | Eviction |
|-----|------|-------|----------|
| `board:{boardId}:snapshot` | String (JSON) or hash fields | Columns, tasks, seq, etag | LRU at maxmemory; optional TTL for dev |

**Population:** On each successful domain mutation affecting board, API updates snapshot asynchronously (or synchronously for small boards) — **trade-off:** strong consistency vs latency; recommended: update in command handler post-commit within same process for single-node, or projector for multi-node.

### 5.2 Job queue (lightweight)

If not using Kafka for all agent triggers, **Redis Streams** or `LIST` can buffer agent jobs — **preferred** single path is Kafka for replay. Redis may still store **dedupe keys** `agent:dedupe:{boardId}:{taskId}:{eventId}` with TTL 24h.

### 5.3 Pub/sub channel design

| Channel | Publishers | Subscribers |
|---------|------------|-------------|
| `sse:board:{boardId}` | API instances | Local SSE hub goroutine per instance subscribing (or use Redis only when cross-pod broadcast needed) |

**Pattern:** Hybrid — in-memory fan-out within pod + Redis pub/sub for multi-pod SSE routing (each API subscribes to channels for boards that have active connections on that pod — routed via subscription map).

### 5.4 Rate limiting / sliding windows

Keys `ratelimit:agent:{boardId}` use sliding window counters (see `dsa.md`) to shed load under burst agent triggers.

---

## 6. Horizontal Scaling

| Component | Scaling approach |
|-----------|------------------|
| **API (Fiber)** | Stateless replicas; sticky sessions **not** required; JWT or session in cookie |
| **SSE** | Scale with Redis pub/sub bridge; limit connections per pod via HPA + connection drainer |
| **Kafka consumers** | Increase partitions = max parallelism per topic key skew awareness |
| **Agent workers** | Horizontal pods; **consistent hashing** on `boardId` to assign preferred worker (see `dsa.md`) while Kafka still balances partitions |
| **PostgreSQL** | Primary + read replicas for query heavy paths; writes to primary |
| **Redis** | Cluster mode for cache + rate limits |

**Consistent hashing rationale:** Improves cache locality (board DAG in memory) and reduces race window when multiple agents process related events — combined with Kafka keyed ordering, this is **best-effort** optimisation, not a correctness requirement.

---

## 7. Failure Modes and Mitigations

| Failure | Symptom | Mitigation |
|---------|---------|------------|
| **Kafka consumer lag** | Stale agent suggestions; growing backlog | Autoscale consumers; drop non-critical agent paths; alert on lag threshold; consider priority topic for BlockerAgent |
| **LLM API timeout** | Agent job hangs | Circuit breaker; bounded context timeout; retries with exponential backoff (max 3); DLQ with payload + error |
| **LLM rate limits** | 429 from Anthropic | Token bucket per API key; queue agents; degrade triage before blocker |
| **SSE disconnect** | User misses live updates | Auto-reconnect with `Last-Event-ID` / `since_seq`; fetch snapshot on gap |
| **Optimistic conflict** | Two users move same task | Server returns 409 with current task + `version`; client rolls back; toast |
| **Redis unavailable** | Snapshot miss | Fall back to PostgreSQL aggregate query (slower); degrade to polling **only if** SSE also down |
| **Split brain on seq** | Duplicated or out-of-order seq | Single source of truth: DB sequence or Redis INCR with durable sync; snapshot repair job |
| **Agent poison message** | Crash loop | DLQ + manual replay tool; schema validation on consume |

---

## 8. Rate Limiting and Back-Pressure

### 8.1 Edge rate limits

- Per IP / per user: standard HTTP rate limits on command endpoints (e.g. 100 req/min).
- Per board: stricter limits on `POST /tasks` during agent storms (linked to agent triggers).

### 8.2 Agent back-pressure

| Mechanism | Description |
|-----------|-------------|
| **Kafka consumer pause** | Pause consumption if downstream Claude queue depth exceeds threshold |
| **Per-board sliding window** | Cap agent job submissions (e.g. max 10 triage runs / 5 min / board) |
| **Priority queue** | BlockerAgent jobs preempt triage when Kafka prioritisation enabled (or separate high-priority topic) |
| **Coalescing** | Multiple `STATUS_CHANGED` for same task within debounce window → single agent run |

### 8.3 SSE back-pressure

- Slow clients: drop connection after max buffered events; client reconnects with snapshot.
- Use server-side per-connection buffer cap (e.g. 256KB).

---

## 9. Observability (Cross-Cutting)

| Signal | Tooling |
|--------|---------|
| Traces | OpenTelemetry: command → plan → Kafka → consumer |
| Metrics | Lag, SSE connections, Redis hit rate, agent latency, Claude token usage |
| Logs | Structured JSON; correlation IDs `mutationId`, `boardId`, `traceId` |
| Dashboards | SLO: p95 command latency < 200ms (excluding LLM), SSE delivery < 1s |

---

## 10. Security Highlights

- All mutations RBAC-checked (workspace role + board capability).
- Agent service account can only perform tool-mapped operations; human users accept/dismiss suggestions for sensitive changes.
- SSE: authorise board before streaming; invalidate on permission revocation (force reconnect 403).

This HLD defers to [`lld.md`](./lld.md) for struct-level detail and [`api-contracts.md`](./api-contracts.md) for wire formats.
