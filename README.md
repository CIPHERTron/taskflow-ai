# FlowTask AI

**FlowTask AI** is a full-stack, AI-native project management platform built around a high-performance Kanban board. The board is not a passive artifact: autonomous agents continuously analyse state, triage work, detect blocker chains on the dependency graph, and balance team load—surfacing suggestions in real time without requiring chat-style prompting.

This repository is structured as a **monorepo** intended for production-grade CQRS + event-driven deployment. Application source code will live under `apps/` once development begins; until then, **architecture and implementation blueprints** live in [`specs/`](./specs/).

---

## Overview

FlowTask AI is an **agentic Kanban** product for teams that want project hygiene—triage, dependency risk, and workload balance—handled **in the background** as the board changes, instead of only through manual grooming or a separate chat assistant.

### Core capabilities

- **Board & collaboration** — Multi-column Kanban (Backlog → Done), drag-and-drop with optimistic updates, rich tasks (assignee, priority, due date, labels, story points, subtasks), **dependency links** with cycle prevention, **virtualised columns** for very large boards, and **SSE** for live sync (no polling).
- **Dependency intelligence** — **DAG** of tasks, automatic blocked handling, **critical path** computation and highlighting.
- **AI agents (autonomous)** — **Triage** (priority + assignee hints via RAG on historical tasks), **Blocker detection** (graph traversal + alerts), **Workload balancer** (sprint load and reassignment suggestions with auto-apply when confidence is high).
- **Agent activity feed** — Live panel of agent actions, reasoning, and confidence, with accept/dismiss for suggestions.
- **Platform features** — Workspaces, multi-board, **RBAC**, **sprints** and velocity, **notifications** (in-app + email for critical events via decoupled consumers).

### Tech stack

| Area | Technologies |
|------|----------------|
| **Frontend** | Next.js 14 (App Router), TypeScript, Zustand, TanStack Query, Tailwind CSS, Framer Motion, **react-window** |
| **Backend** | Go (**Fiber**), REST + **SSE** |
| **Messaging & cache** | **Kafka** (event fan-out), **Redis** (LRU board snapshots, rate limits, optional coordination) |
| **Data** | **PostgreSQL**, **pgvector** (embeddings for agent RAG) |
| **AI** | **Anthropic Claude** (tool use; streaming where useful) |
| **Ops (target)** | Docker Compose locally; **Kubernetes**-ready manifests under `infra/` |

### Technical specification (short)

Implementation is specified in **[`specs/`](./specs/)**, not in prose here: **HLD** (topology, Kafka topics, Redis, SSE, scaling, failures), **LLD** (Go types, agent job state machine, optimistic concurrency, Zustand shapes), **DSA** (heap, DAG/topo/DP, consistent hash, LRU, virtual windowing, rate windows), **database schema** (DDL + pgvector), **REST & SSE contracts**, **agent prompts/tools/RAG/DLQ**, and **UI** (routes, dnd-kit, hooks, a11y). Together these define CQRS-style writes, event-driven agents, and real-time read paths without blocking the UI on LLM latency.

---

## Motivation

Engineering teams juggling dependencies, grooming overhead, and uneven workloads often spend more time _managing_ work than _shipping_. FlowTask AI targets small-to-mid-size teams (roughly 5–50 people) that:

- Need explicit task dependencies and critical-path visibility.
- Want backlog hygiene and sprint planning assistance without another chat surface.
- Benefit from agents that act on **board events** (create, move, sprint start), not ad-hoc user prompts.

The product thesis: **the board is alive**—the system thinks alongside the team while preserving human control (accept/dismiss, roles, and explicit commands).

---

## Architecture Summary

FlowTask AI separates **writes** from **reads** and pushes all side effects through **Kafka** so slow operations (notably LLM calls) never block interactive board updates.

| Layer                    | Responsibility                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Web app** (`apps/web`) | Next.js 14 App Router UI: virtualised Kanban, optimistic DnD, Zustand + TanStack Query, SSE client.                              |
| **API** (`apps/api`)     | Go (Fiber): REST commands/queries, SSE stream per board, auth, validation, publishes domain events to Kafka.                     |
| **Command path**         | Validates mutations → PostgreSQL transactional write → outbox/event publish → Kafka.                                             |
| **Query path / cache**   | Read models, Redis LRU snapshots, fast `GET` for board/task aggregates; SSE fan-out.                                             |
| **Agents**               | Kafka consumers (worker pool): TriageAgent, BlockerAgent, BalancerAgent; Claude + tools; results as suggestions or auto-applies. |
| **Notifications**        | Separate Kafka consumer service: email + in-app fan-out, decoupled from hot path.                                                |

**CQRS (pragmatic):** The same API process _can_ host command + query handlers for simpler deployments, but the _logical_ split is strict: commands emit events; queries never mutate. Horizontal scaling assumes **stateless** API and **partition-aware** agent workers (see [`specs/hld.md`](./specs/hld.md)).

**Event-driven fan-out:** `TASK_CREATED`, `STATUS_CHANGED`, `SPRINT_STARTED`, etc., drive agent workflows. SSE broadcasts consolidate **read-side** updates (`TASK_MOVED`, `AGENT_SUGGESTION`, …) with **monotonic sequence IDs** per board for gap detection.

**Multi-agent:** Each agent implements a shared interface (`Run`, `Rollback`, `Name`), owns its triggers, tool surface, confidence policy, and retry/dead-letter behaviour—documented in [`specs/agents.md`](./specs/agents.md) and [`specs/lld.md`](./specs/lld.md).

---

## Monorepo Layout

Planned structure (documentation reflects this target; scaffolding is intentional deferred):

```text
.
├── apps/
│   ├── web/                 # Next.js 14 (App Router), TypeScript, Zustand, TanStack Query, Tailwind, Framer Motion, react-window
│   └── api/                 # Go (Fiber): REST + SSE, Kafka producers/consumers, Redis, Postgres/pgvector clients
├── infra/
│   ├── docker-compose.yml   # Local Postgres, Redis, Kafka, (optional) services for web/api
│   └── k8s/                 # Kubernetes manifests (Deployments, Services, ConfigMaps, HPA stubs)
├── specs/                   # Implementation blueprints (read before coding)
│   ├── hld.md               # High-level design: topology, Kafka, Redis, SSE, scaling, failure modes
│   ├── lld.md               # Low-level design: Go structs, agents, job FSM, optimistic protocol, Zustand slices
│   ├── dsa.md               # Heaps, DAG algorithms, consistent hashing, LRU, virtual list, rate limits
│   ├── db-schema.md        # PostgreSQL + pgvector DDL, indexes, migrations
│   ├── api-contracts.md    # REST + SSE contracts (TypeScript types for request/response)
│   ├── agents.md           # Prompts, tools, orchestration, RAG, confidence tables
│   └── ui.md               # Routes, components, hooks, a11y, performance
└── README.md               # This file
```

---

## Local Development (Docker Compose)

**Principle:** Developers run dependencies via Compose; `apps/web` and `apps/api` run locally for fast iteration _or_ in containers as profiles.

Planned `infra/docker-compose.yml` services (names are indicative):

| Service    | Image / Role                                                                       |
| ---------- | ---------------------------------------------------------------------------------- |
| `postgres` | PostgreSQL 16+ with `pgvector` extension                                           |
| `redis`    | Redis 7+ for LRU snapshots, optional lightweight job queue                         |
| `kafka`    | Kafka (e.g. Apache Kafka or Redpanda for local) + ZooKeeper/KRaft per image choice |
| `web`      | (Optional profile) Next.js production build                                        |
| `api`      | (Optional profile) Go API binary                                                   |

**Typical bootstrap (after code exists):**

1. Copy `.env.example` → `.env` and fill values (see below).
2. `docker compose -f infra/docker-compose.yml up -d postgres redis kafka`
3. Run DB migrations (`golang-migrate` against `DATABASE_URL`).
4. Start API (`apps/api`) and Web (`apps/web`) with hot reload.

Until `docker-compose.yml` is committed, treat the above as the **target** contract described in specs.

---

## Environment Variables

Variables are grouped by consumer. Names follow UPPER_SNAKE_CASE.

### API (Go — `apps/api`)

| Variable                    | Required | Description                                             |
| --------------------------- | -------- | ------------------------------------------------------- |
| `HTTP_ADDR`                 | Yes      | Bind address, e.g. `:8080`                              |
| `DATABASE_URL`              | Yes      | PostgreSQL DSN (include `sslmode` for prod)             |
| `REDIS_URL`                 | Yes      | Redis connection URL                                    |
| `KAFKA_BROKERS`             | Yes      | Comma-separated broker list                             |
| `KAFKA_CLIENT_ID`           | Yes      | Producer/consumer client ID prefix                      |
| `ANTHROPIC_API_KEY`         | Yes      | Claude API key for agents (server-side only)            |
| `JWT_SECRET` / `JWT_ISSUER` | Prod     | Auth signing + issuer (or OIDC provider config)         |
| `SSE_HEARTBEAT_INTERVAL`    | No       | Seconds between SSE comments/heartbeats (default 15–30) |
| `BOARD_SNAPSHOT_TTL_SEC`    | No       | Redis LRU entry TTL hint / max staleness target         |
| `AGENT_MAX_RETRIES`         | No       | Default 3 (override per agent if needed)                |
| `LOG_LEVEL`                 | No       | `debug`, `info`, `warn`, `error`                        |

### Web (Next.js — `apps/web`)

| Variable                          | Required         | Description                                       |
| --------------------------------- | ---------------- | ------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`        | Yes              | Public base URL for browser calls to API          |
| `NEXT_PUBLIC_SSE_BASE_URL`        | Often            | Same or different origin for SSE (CORS-sensitive) |
| `NEXTAUTH_SECRET` / provider keys | If using Auth.js | Session + OAuth (if chosen)                       |

### Workers / Notifications (future services)

| Variable                    | Required  | Description                            |
| --------------------------- | --------- | -------------------------------------- |
| `KAFKA_GROUP_NOTIFICATIONS` | Yes       | Consumer group for notification worker |
| `SMTP_HOST` / `SMTP_*`      | For email | Outbound mail for critical blockers    |
| `EMAIL_FROM`                | For email | Sender address                         |

### Infrastructure

| Variable                                              | Description        |
| ----------------------------------------------------- | ------------------ |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Compose Postgres   |
| `REDIS_PASSWORD`                                      | Optional Redis ACL |

---

## How the Agent System Works (Plain English)

1. **Something happens on the board**—a task is created, moved, or a sprint starts. The API commits the change and emits a **fact** to Kafka (e.g. “task created in backlog”).
2. **The right agent wakes up.** A small orchestration layer maps event types + payloads to **Triage**, **Blocker**, or **Balancer** logic. Workers compete for partitions; assignment can be refined with **consistent hashing** on `boardId` so the same board tends to hit the same worker (warm caches, ordered processing).
3. **The agent gathers context.** It reads tasks, dependencies, assignee load, and (for triage) **RAG retrieval** of similar historical tasks from **pgvector**.
4. **The agent calls Claude** with structured **tools**—never raw SQL from the model. Tools map to whitelisted operations: adjust priority, flag blockers, suggest reassignments.
5. **Outputs become suggestions or auto-actions.** High-confidence balancer outputs may **auto-apply**; most triage/blocker outputs appear as **suggestion cards** in the Agent Activity Feed. The API persists suggestions; the user accepts or dismisses.
6. **Everyone sees updates live.** Applied changes and new suggestions are **broadcast over SSE** with sequence IDs so clients stay aligned without polling.

Agents are **not** a chat UI: they run on **triggers** and **schedules**, aligned with the product brief.

---

## Key Design Decisions and Tradeoffs

| Decision                            | Rationale                                                                  | Tradeoff                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Kafka + CQRS**                    | Decouples LLM latency from user mutations; scales consumers independently. | Operational complexity; must monitor lag and DLQ.                                      |
| **Redis board snapshot + SSE**      | Instant reconnect; sub-second fan-out for collaborative feel.              | Cache invalidation discipline; snapshot vs event ordering must be specified (see HLD). |
| **Optimistic UI (DnD)**             | Perceived zero-latency moves; SSE reconciles truth.                        | Conflict handling via task `version` + user-visible rollback.                          |
| **DAG in PostgreSQL**               | Durable, transactional dependency edges; cycle check in API.               | Graph algorithms run in application layer (acceptable at target scale with indexing).  |
| **pgvector for RAG**                | Keeps embeddings near operational data; simpler security boundary.         | Embedding refresh pipeline must be defined; not a general document store.              |
| **Claude tool use**                 | Constrains mutating power of the model; auditable actions.                 | Prompt/tool maintenance overhead; API cost governance.                                 |
| **Virtualised columns (10k+ rows)** | Keeps 60fps scrolling for massive boards.                                  | Variable row heights complicate measurement; binary search + cache strategy required.  |

---

## Specification Index

| Document                                           | Focus                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| [specs/hld.md](./specs/hld.md)                     | System diagram, topics, Redis/SSE, scaling, failures, back-pressure |
| [specs/lld.md](./specs/lld.md)                     | Structs, agent FSM, protocols, Zustand/App Router shapes            |
| [specs/dsa.md](./specs/dsa.md)                     | Heaps, topo sort, DP, hashing, LRU, windowing, rate limit           |
| [specs/db-schema.md](./specs/db-schema.md)         | DDL, indexes, soft delete, optimistic locking                       |
| [specs/api-contracts.md](./specs/api-contracts.md) | REST + SSE payloads and errors                                      |
| [specs/agents.md](./specs/agents.md)               | Prompts, tools, streaming, RAG, DLQ                                 |
| [specs/ui.md](./specs/ui.md)                       | Routes, components, hooks, a11y                                     |

---

## Development status

**Application code is not scaffolded yet.** Use this README plus `specs/` as the source of truth until you explicitly start implementation.

---