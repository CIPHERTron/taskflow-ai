This document specifies each algorithm and structure used in FlowTask AI: the problem, chosen structure, implementation detail, complexity, and tradeoffs.

---

## 1. Min-heap — Task Priority Queue (TriageAgent)

### Problem

Maintain a dynamic set of tasks in **Backlog** ordered by triage-derived **priority score** so the highest-priority task is extracted in **O(log n)** and scores can be updated when the agent recomputes rankings.

### Chosen structure

**Binary min-heap** (Go: `container/heap` with inverted comparator to simulate max-heap if needed — product requirement: higher score = higher priority → use **max-heap** via negated score or custom `Less`).

### Implementation detail

- Define type `TaskHeap []*TaskNode` where `TaskNode` holds `TaskID`, `Score float64`, `HeapIndex int`.
- Implement `heap.Interface` (`Len`, `Less`, `Swap`, `Push`, `Pop`).
- Maintain **map[taskID]heapIndex** for **O(log n) decrease-key / increase-key** via `heap.Fix(h, idx)` after score change.
- On TriageAgent update: if task not in heap and column is Backlog, `heap.Push`; if score changes, update node and `heap.Fix`.

### Complexity

| Operation       | Time                    |
| --------------- | ----------------------- |
| Insert          | O(log n)                |
| Pop max         | O(log n)                |
| Update priority | O(log n) with index map |
| Peek            | O(1)                    |

Space: **O(n)** for n backlog tasks in heap + index map.

### Tradeoffs vs alternatives

| Alternative                  | Pros                            | Cons                                                        |
| ---------------------------- | ------------------------------- | ----------------------------------------------------------- |
| Sorted slice + binary search | Simple                          | Insert/delete O(n) shifts                                   |
| Fibonacci heap (amortised)   | Better theoretical decrease-key | Complex; larger constants; rarely wins at product scale     |
| PostgreSQL `ORDER BY` only   | Persistent                      | Hot-path agent needs in-memory structure for fast iteration |

---

## 2. DAG + Kahn’s Topological Sort

### Problem

- Validate new dependency edges **without cycles**.
- Produce a linear order for processing tasks BlockerAgent (dependencies before dependents).
- Detect tasks that cannot proceed because upstream incomplete.

### Chosen structure

**Adjacency list** + **in-degree array/map**: `map[taskID][]successor`, `map[taskID]inDegree`.

### Implementation detail (cycle check on edge `u → v`)

1. Temporarily add edge; run **Kahn**:
   - Queue nodes with in-degree 0.
   - Pop, decrement successors; count visited.
2. If `visited < |V|` → cycle; **reject** edge.
3. Alternatively for incremental: **DFS three-colour** on demand for path `v` can reach `u` — O(V+E) per check; acceptable for board-sized graphs.

**Kahn algorithm:**

```text
Q = all nodes with in-degree 0
count = 0
while Q not empty:
    x = pop Q
    count++
    for each y in adj[x]:
        indegree[y]--
        if indegree[y] == 0: push y
return count == n
```

### Complexity

- Time: **O(V + E)** per full sort or cycle check on the board subgraph.
- Space: **O(V + E)**.

### Tradeoffs vs alternatives

| Alternative | When better                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| Union-find  | Not suitable for directed cycles                                             |
| Tarjan SCC  | When need strongly connected components for UX beyond simple cycle rejection |

---

## 3. Dynamic Programming on DAG — Critical Path Length

### Problem

For each task, compute the **longest path** from a “source” task (no predecessors in board scope) through dependency edges to that task — used to highlight **critical path** and BlockerAgent risk scoring.

### Model

Directed acyclic task graph (validated). Edge `u → v` means **v depends on u** (v cannot complete until u completes — adjust direction consistently in code).

Assume: **Critical path length** for risk = max sum of **duration weights** along dependency chains. MVP weight = **1 per task** or **story points**.

### Recurrence

Process tasks in **topological order** `t1,...,tn`.

Let `dp[t]` = maximum weighted path ending at `t` (from any source).

For each `t` in topo order:

```text
dp[t] = w(t) + max{ dp[p] : (p, t) is dependency edge }
```

If `t` has no predecessors: `dp[t] = w(t)`.

**Critical path length for board** = `max_t dp[t]`.

Store `predBest[t] = argmax p` for backtracking path highlighting.

### Complexity

Time **O(V + E)**; Space **O(V)** for `dp` + parent pointers.

### Tradeoffs vs alternatives

| Alternative                                 | Notes                        |
| ------------------------------------------- | ---------------------------- |
| Single-source longest path on general graph | NP-hard; DAG makes it linear |
| PERT with probabilities                     | Future enhancement           |

---

## 4. Consistent Hashing Ring — Agent Worker Routing

### Problem

Map `(boardId, partition)` to a **preferred worker** to improve cache locality and ordering **without** sacrificing Kafka’s balanced consumption.

### Chosen structure

**Consistent hash ring**: sorted slice of hash positions → each physical worker owns arcs; virtual nodes (vnodes) per worker to reduce imbalance.

### Implementation detail

- Hash `boardId` to 64-bit.
- Binary search ring for owner.
- Maintain `vnodeCount` (e.g. 100) replicas per worker ID string.
- On worker membership change, only fraction of boards remap.

### Complexity

Lookup: **O(log K)** for K vnodes (binary search). Rebuild ring on membership change: **O(K log K)**.

Space: **O(K)**.

### Tradeoffs vs alternatives

| Alternative            | Cons                                                    |
| ---------------------- | ------------------------------------------------------- |
| Pure modulo hashing    | Large remapping on scale changes                        |
| Sticky Kafka partition | Already provides ordering; ring adds soft affinity only |

---

## 5. LRU Cache — Board Snapshot Eviction

### Problem

Bound Redis memory for `board:{id}:snapshot` while keeping **most recently accessed** boards hot.

### Chosen structure

**Hash map + doubly linked list** (classic LRU). In Redis: use **`maxmemory-policy allkeys-lru`** natively — application-level LRU for in-process DAG cache mirrors same policy.

### Implementation detail (in-process optional)

- `map[key]*Node` and dummy head/tail.
- On `Get`: move node to front O(1).
- On `Put` at capacity: evict tail O(1).

### Complexity

Per access: **O(1)** time, **O(capacity)** space.

### Tradeoffs vs alternatives

| Alternative    | Notes                                  |
| -------------- | -------------------------------------- |
| Redis TTL only | Time-based, not frequency-based        |
| LFU            | Better for skewed access; more complex |

---

## 6. Virtual List Windowing — Binary Search for Visible Row Range

### Problem

Render **10,000+** task rows per column at 60fps — only **visible** subset mounts.

### Chosen structure

**Variable-size list** (`react-window` `VariableSizeList`) + **prefix sum array** of row heights.

### Implementation detail

- Maintain `prefix[i] = sum(h[0..i-1])`, monotonic increasing.
- Viewport exposes `scrollTop` and `viewportHeight`.
- **Lower bound** `i` such that `prefix[i] <= scrollTop < prefix[i+1]` via binary search — **first visible index**.
- **Upper bound** `j` for `scrollTop + viewportHeight` — **last visible index**.
- **Overscan** of 3–5 rows above/below to reduce blank flashes during fast scroll.

### Complexity

Each scroll event: **O(log n)** for both indices; space **O(n)** for prefix sums (recomputed when heights batch-update).

### Tradeoffs vs alternatives

| Alternative                  | Cons                                      |
| ---------------------------- | ----------------------------------------- |
| Fixed row height             | Simpler but poor UX for multi-line titles |
| Naïve linear scan per scroll | O(n) — fails at 10k                       |

---

## 7. Memoized Selectors — Zustand Derived State

### Problem

Derived data (critical path set, filtered tasks) should avoid re-rendering when **unrelated** slices change.

### Chosen structure

**Shallow-equality memo** with **referential stability**: selector returns same array/object reference if inputs unchanged.

### Implementation detail

- Use `zustand/shallow` for comparing picked slices.
- Wrap expensive selectors:

```typescript
const expensiveSelector = useMemo(
  () =>
    shallow((s: Store) => ({
      tasksById: s.board.tasksById,
      deps: s.board.depsVersion,
    })),
  [],
);
```

- Or external **reselect**-style: `createSelector` caching last `(depsVersion, tasksVersion) → criticalPathTaskIds`.

### Complexity

Selector recompute: **O(1)** amortised when deps unchanged; when changed, **O(V+E)** if recomputing graph projection.

Space: **O(1)** extra beyond cached output.

### Tradeoffs vs alternatives

| Alternative         | Notes                       |
| ------------------- | --------------------------- |
| Recompute in render | Causes jank on large boards |
| MobX computed       | Similar automatic tracking  |

---

## 8. Sliding Window — Rate Limiting Agent Jobs per Board

### Problem

Prevent agent **storms** when bulk imports flood Kafka — cap agent executions per `boardId` per window **without** harsh global throttle.

### Chosen structure

**Sliding window log** or **approximate sliding window counter** in Redis.

### Implementation detail (Redis + Lua or `MULTI`)

- Key `ratelimit:agent:{boardId}` stores sorted set of timestamps **or** segmented counters per second bucket.
- On each job: `ZREMRANGEBYSCORE` remove older than `now - window`; `ZCARD`; if `< limit` then `ZADD` and allow; else deny/coalesce.
- Window: e.g. **5 minutes**, limit **20** triage jobs.

### Complexity

Per check: **O(log N)** in window size N (bounded by pruning); space proportional to accepted events in window.

### Tradeoffs vs alternatives

| Alternative  | Notes                                       |
| ------------ | ------------------------------------------- |
| Token bucket | Smoother; slightly different UX under burst |
| Fixed window | Simpler but boundary spikes                 |

---

## Summary Table

| #   | Structure / Algorithm  | Primary consumer    | Time (typical)  | Space          |
| --- | ---------------------- | ------------------- | --------------- | -------------- |
| 1   | Heap + index map       | TriageAgent / API   | O(log n) update | O(n)           |
| 2   | Kahn topo + indegree   | BlockerAgent        | O(V+E)          | O(V+E)         |
| 3   | DP on DAG              | BlockerAgent UI     | O(V+E)          | O(V)           |
| 4   | Consistent hash ring   | Agent orchestrator  | O(log K)        | O(K)           |
| 5   | LRU                    | Redis / in-proc     | O(1)            | O(cap)         |
| 6   | Prefix + binary search | react-window column | O(log n)        | O(n)           |
| 7   | Memo selectors         | Zustand UI          | O(1) hot        | O(1)–O(output) |
| 8   | Sliding window ZSET    | Rate limiter        | O(log N)        | O(N_win)       |

Refer to [`lld.md`](./lld.md) for where these attach to services and [`agents.md`](./agents.md) for agent-specific triggers.
