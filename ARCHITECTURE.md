# LifePilot — Architecture Guide

> **⚠️ CRITICAL: READ THIS BEFORE MAKING ANY DATA-RELATED CHANGES.**
> This document defines the core data architecture for LifePilot.
> Every agent, developer, or AI assistant working on this codebase MUST follow these patterns.

## 🏛️ Core Principle: Offline-First

LifePilot follows an **offline-first** architecture, the same pattern used by
Microsoft To Do, Google Tasks, Todoist, and other production task apps.

### The Rules

1. **READ**: Always load from **local phone storage first** (instant UI) → then fetch from Supabase in background → silently update cache + UI
2. **WRITE**: Update **local state + AsyncStorage first** (instant feedback) → sync to Supabase via SyncQueue (queued if offline)
3. **OFFLINE**: App works fully. Changes are queued in `SyncQueue` and replayed when connectivity returns
4. **NEVER** show a loading spinner if cached data exists locally

---

## 📦 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Backend** | Supabase (PostgreSQL) | Auth, database, storage |
| **Local Storage** | `AsyncStorage` via `src/utils/storage.js` | Persistent cache on phone |
| **Sync Engine** | `src/lib/syncQueue.js` | Offline mutation queue with retry |
| **Data Layer** | `src/lib/dataManager.js` | Central read/write API for all screens |
| **Auth** | Supabase Auth + AsyncStorage sessions | Persisted sessions, auto-refresh |
| **Notifications** | `expo-notifications` via `src/utils/notifications.js` | Local push notifications |
| **Gamification** | `src/utils/gamification.js` | XP, levels, streaks |
| **Repeat Engine** | `src/utils/repeatEngine.js` | Daily reset of recurring tasks |

---

## 📐 Data Flow

### Reading Data (All Screens)

```
Screen Opens
  → Load from AsyncStorage (instant, no spinner)
  → Show cached data in UI
  → Background: drain SyncQueue (retry any pending writes)
  → Background: fetch fresh from Supabase
  → On success: update AsyncStorage + update UI silently
  → On failure (offline): no-op, cached data is already showing
```

### Writing Data (Mutations)

```
User Action (e.g., toggle task, add task, delete)
  → Update React state (optimistic UI — instant)
  → Save updated data to AsyncStorage (survives app restart)
  → Call syncToSupabase() from SyncQueue
    → If ONLINE: execute Supabase mutation immediately
    → If OFFLINE: persist operation to AsyncStorage queue
  → When back online: drainSyncQueue() replays all pending ops
```

### Conflict Resolution

- **Strategy: Last-Write-Wins** (same as Google Tasks)
- If a task is modified both locally and remotely, the latest write overwrites
- On fresh fetch from Supabase, server data replaces local cache

---

## 🔧 Key Files

| File | Purpose |
|------|---------|
| `src/lib/dataManager.js` | **USE THIS** — Central API for all data reads and writes |
| `src/lib/syncQueue.js` | Offline mutation queue — persists failed Supabase writes for retry |
| `src/lib/supabase.js` | Supabase client (auth, DB, storage) |
| `src/utils/storage.js` | AsyncStorage wrapper (key-value, prefixed with `@lifepilot_`) |
| `src/utils/notifications.js` | Local push notifications (schedule, cancel, reschedule) |
| `src/utils/repeatEngine.js` | Resets completed recurring tasks daily |
| `src/utils/gamification.js` | XP, levels, streaks tracking |

---

## 🚨 Rules for New Features

### ✅ DO

- Use `dataManager.js` for ALL data operations — never call Supabase directly in screens
- Update local state FIRST (optimistic UI), then sync in background
- Call `drainSyncQueue()` on screen focus / app launch
- Cache all fetched data to AsyncStorage via `Storage.set()`
- Show cached data immediately, use subtle refresh indicators (not full-screen spinners)
- Handle the case where Supabase returns an error (offline) gracefully — just use cache

### ❌ DON'T

- Don't call `supabase.from('tasks').select(...)` directly in screen components
- Don't show a loading spinner if cached data exists
- Don't assume the user is always online
- Don't `await` Supabase mutations before updating UI (optimistic updates!)
- Don't store sensitive data in AsyncStorage — auth tokens go through Supabase's built-in auth storage

### 📝 Template: New Screen with Data

```javascript
import { loadTasks, cacheTasks, toggleTaskCompletion } from '../lib/dataManager';
import { drainSyncQueue } from '../lib/syncQueue';

const MyScreen = ({ navigation }) => {
  const [tasks, setTasks] = useState([]);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);

      // Load from cache (instant) → fetch fresh in background
      const cached = await loadTasks(session.user.id, (fresh) => {
        setTasks(fresh); // Silent background update
      });
      setTasks(cached);
    };
    init();
  }, []);

  // On screen focus — drain queue + refresh
  useFocusEffect(useCallback(() => {
    if (userId) {
      drainSyncQueue();
      loadTasks(userId, setTasks);
    }
  }, [userId]));

  const handleToggle = async (taskId, currentStatus) => {
    // Optimistic update → cache → sync
    const updated = await toggleTaskCompletion(userId, tasks, taskId, currentStatus);
    setTasks(updated);
  };
};
```

---

## 📊 Database Schema (Supabase)

### `profiles` table
| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | User ID from Supabase Auth |
| username | text | Unique username |
| display_name | text | User's display name |
| avatar_url | text | Profile picture URL |
| avatar_seed | text | Fallback avatar seed |

### `tasks` table
| Column | Type | Description |
|--------|------|-------------|
| id | bigint (PK) | Auto-increment |
| user_id | uuid (FK) | Owner |
| title | text | Task title |
| is_completed | boolean | Completion status |
| is_important | boolean | Starred/important flag |
| due_date | timestamptz | Due date |
| reminder_time | timestamptz | When to send reminder notification |
| repeat_rule | text | e.g. "daily", "weekly", "every 2 weeks" |
| quadrant | text | Eisenhower matrix quadrant |
| order_index | integer | Custom sort order |
| created_at | timestamptz | Creation timestamp |

---

## 🔑 AsyncStorage Keys

| Key Pattern | Data |
|-------------|------|
| `@lifepilot_tasks_{userId}` | Full task list (Array) |
| `@lifepilot_profile_{userId}` | User profile (Object) |
| `@lifepilot_daily_quote_data` | Today's motivational quote |
| `@lifepilot_promisesConfig_{userId}` | Daily promises configuration |
| `@lifepilot_sortBy_today` | Sort preference for Today screen |
| `@lifepilot_sortBy_starred` | Sort preference for Starred screen |
| `@lifepilot_sync_queue` | Pending offline mutations (SyncQueue) |
| `@lifepilot_gamification_{userId}` | XP, level, streak data |

---

## 📱 Screens

| Screen | Data Source | Mutations |
|--------|-----------|-----------|
| Dashboard | tasks (cache) + profile (cache) + quote (cache/API) | toggleTask |
| Today | tasks (cache → Supabase) | add, toggle, delete, star, reorder |
| Starred | tasks filtered (cache → Supabase) | toggle, star |
| Promises | promisesConfig (cache only) | add, remove, toggle |
| Settings | profile (cache → Supabase) | update name, username, avatar |

---

*Last updated: June 2026*
*Architecture version: 2.0 (offline-first)*
