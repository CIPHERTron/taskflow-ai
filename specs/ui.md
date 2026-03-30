# FlowTask AI — UI Implementation

Stack: **Next.js 14 (App Router)**, **TypeScript**, **Zustand**, **TanStack Query**, **Tailwind CSS**, **Framer Motion**, **react-window** (`VariableSizeList`), **dnd-kit**, **react-hook-form**, **Zod**.

---

## 1. App Router Structure

| Route | `layout.tsx` | `page.tsx` | `loading.tsx` | `error.tsx` |
|-------|--------------|------------|---------------|-------------|
| `/` | `app/layout.tsx` root | `app/page.tsx` marketing or redirect | `app/loading.tsx` | `app/error.tsx` |
| `/login` | `app/(auth)/layout.tsx` minimal chrome | `app/(auth)/login/page.tsx` | optional | `app/(auth)/login/error.tsx` |
| `/app` | `app/(dashboard)/layout.tsx` shell | `app/(dashboard)/app/page.tsx` home | `app/(dashboard)/loading.tsx` | `app/(dashboard)/error.tsx` |
| `/app/w/[workspaceId]/boards` | inherits dashboard | `.../boards/page.tsx` | grid skeleton | segment `error.tsx` |
| `/app/w/[workspaceId]/b/[boardId]` | `.../b/[boardId]/layout.tsx` board chrome + providers | `.../b/[boardId]/page.tsx` | board shimmer | board `error.tsx` |

**Root layout responsibilities**

- `metadata` export
- Font strategy: `next/font` (Inter + mono for IDs in dev toggles)
- Global `app/globals.css`
- Providers wrapper component `app/providers.tsx`

---

## 2. Component Hierarchy — Board View

Top-down tree:

```text
BoardPage
├── BoardHeader (title, sprint controls, filters)
├── BoardMain (horizontal scroll columns)
│   ├── ColumnDropZone (dnd-kit droppable per column)
│   │   ├── ColumnHeader (WIP, count, collapse)
│   │   └── VirtualizedTaskList
│   │       ├── VariableSizeList (react-window)
│   │       │   ├── TaskCard (memo)
│   │       │   └── ...
│   │       └── Scroll sentinel / load-more (if paginated)
│   └── … more columns
├── AgentActivityPanel (slide-over / fixed right rail)
│   ├── ActivityFeedList
│   │   ├── AgentFeedItem
│   │   └── SuggestionCard (Accept / Dismiss)
│   └── EmptyState
└── TaskDetailDrawer (optional parallel route @modal)
```

**Framer Motion:** column enter/exit subtle height accordion; drag placeholder spring config tuned low stiffness.

---

## 3. Virtualised Column

### 3.1 `VariableSizeList`

- Each `TaskCard` measures height via `ref` + `ResizeObserver`; cache in `itemSize` map keyed by `taskId`.
- On content change, call `listRef.current.resetAfterIndex(index, true)`.
- **Overscan:** 6 items — balances blanking vs work per scroll tick.
- **Binary search** for `scrollToTask(taskId)` using cached `prefixHeights` array (`dsa.md`).

### 3.2 Initial scroll offset

- On deep-link `?task=` compute index via id→index map; `scrollToItem` after Double `requestAnimationFrame` to ensure measurement commits.

---

## 4. Drag and Drop — dnd-kit

### 4.1 Optimistic sequence on drop

1. `onDragStart`: `uiSlice.dragPreview` set; selected task elevation.
2. `onDragOver`: compute target column + index (sortable).
3. `onDragEnd`:
   - If invalid: cancel.
   - Else: `boardSlice.optimisticMove({ taskId, toColumnId, sortOrder, mutationId })`.
   - Fire `useMutation` TanStack Query calling `PATCH /tasks/:id/move`.
4. **Success path:** await SSE `TASK_MOVED` `mutationId` match → clear `pendingMutations`.
5. **Failure:** `rollbackMutation(mutationId)` + toast from `uiSlice`.

### 4.2 Collision detection

- `pointerWithin` + custom column rect for wide boards.

### 4.3 Accessibility

- Keyboard sensors enabled; `aria-grabbed` on handle.

---

## 5. Zustand Architecture

### 5.1 Slice pattern

`createStore()` with `combine` or middleware stack:

```typescript
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// Factory return type is the intersection of slices (specs/lld.md §7).
export const useStore = create(
  devtools(
    persist(
      (set, get, store) => ({
        ...createBoardSlice(set, get, store),
        ...createAgentSlice(set, get, store),
        ...createUiSlice(set, get, store),
      }),
      {
        name: 'flowtask-ai-ui',
        partialize: (s) => ({
          activityPanelOpen: s.activityPanelOpen,
          columnWidthsById: s.columnWidthsById,
        }),
      }
    )
  )
);
```

### 5.2 Selector memoization

- Export fine-grained selectors: `useStore((s) => s.board.tasksById[id], shallow)`.
- Heavy derived: `selectCriticalPathTasks = createSelector(...)`.

### 5.3 Devtools

- Namespace: `FlowTask AI` store name; only enable when `process.env.NODE_ENV === 'development'`.

---

## 6. SSE Hook — `useSSE(boardId: string)`

### 6.1 API

```typescript
function useSSE(boardId: string | null): {
  status: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
  lastSeq: number;
  lastError?: Error;
  reconnect: () => void;
};
```

### 6.2 Behaviour

- Opens stream with `fetch` + `ReadableStream` if auth header required; fallback `EventSource` for simple Bearer-less dev.
- Parses `id` field as seq; dispatches `boardSlice.applySSEEvent`.
- Heartbeat ignores.
- Exponential backoff: `1s, 2s, 4s, …, max 30s`.
- On visible tab (`document.visibilityState`), force health check + reconnect if stale > 45s.

### 6.3 Cleanup

- `AbortController.abort()` on unmount or `boardId` change.

---

## 7. Agent Activity Feed

- Panel toggles via header button; width ~360px; scrollable lock when modal open.
- **SuggestionCard** shows: agent avatar glyph, `confidence` as labelled badge (`high` >0.85 amber, `mid` 0.55–0.85, `low` otherwise greyed).
- **Accept:** `POST /suggestions/:id/accept` → on success remove from pending map, toast.
- **Dismiss:** prompts optional reason textarea (collapsible).
- Optimistic removal discouraged; wait for 200 to avoid divergence.

---

## 8. Forms — Zod + react-hook-form

| Form | Schema highlights |
|------|-------------------|
| Create task | title min 1 max 200; description max 50k; dueDate ISO date |
| Edit task | same + `beforeVersion` hidden field |
| New board | name max 120 |
| Sprint | date range `end >= start` |

**Integration pattern**

```typescript
const schema = z.object({ title: z.string().min(1) });
type FormValues = z.infer<typeof schema>;

const form = useForm<FormValues>({ resolver: zodResolver(schema) });
```

**Errors:** `FieldError` under inputs; `form.formState.errors.root` for server 400 mapping.

---

## 9. Performance Patterns

| Pattern | Application |
|---------|-------------|
| `React.memo` | `TaskCard`, `AgentFeedItem` |
| `useCallback` | DnD handlers passed deep |
| Dynamic `import()` | Heavy charts (velocity sparkline), markdown renderer |
| `next/image` | Avatars only if remote URLs stable |
| Code splitting | Board route lazy child components |
| TanStack Query `staleTime` | Board metadata 30s; tasks Infinity until SSE invalidation |

---

## 10. Accessibility

| Area | Requirement |
|------|-------------|
| Board | Arrow keys navigate focused task; `roving tabindex` in column |
| Drag handles | `role="button"` + `aria-label="Reorder task"` |
| Live region | `aria-live="polite"` for agent feed additions |
| Modals | Focus trap; restore focus on close |
| Colour | Critical path highlight not colour-only (icon + pattern stripe) |

---

## 11. TanStack Query Keys

```typescript
export const qk = {
  board: (id: string) => ['board', id] as const,
  tasks: (boardId: string, filters: object) => ['tasks', boardId, filters] as const,
  criticalPath: (taskId: string) => ['criticalPath', taskId] as const,
  velocity: (sprintId: string) => ['velocity', sprintId] as const,
};
```

**Invalidation:** On SSE `TASK_*` / `BOARD_SNAPSHOT`, invalidate affected `qk.tasks` or merge into cache manually for smoother UX.

---

## 12. Stlying Conventions (Tailwind)

- Spacing scale consistent `gap-3`, `p-4` on cards.
- Column min-width `w-80`; horizontal scroll `snap-x` optional polish.
- Dark mode via `class` strategy `dark:` variants.

---

## Related Documents

- [`api-contracts.md`](./api-contracts.md) — typed events
- [`lld.md`](./lld.md) — Zustand slice detail
- [`dsa.md`](./dsa.md) — virtualization binary search
