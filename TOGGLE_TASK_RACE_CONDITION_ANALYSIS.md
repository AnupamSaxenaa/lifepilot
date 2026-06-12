# 🚨 CRITICAL: toggleTaskCompletion Race Condition Analysis

## Severity: **CRITICAL** 🔴
**Date:** June 12, 2026  
**Scope:** Multiple screens affected

---

## 🎯 Executive Summary

The `toggleTaskCompletion` function in `dataManager.js` has a **fundamental design flaw** that causes race conditions across multiple screens. When screens load tasks from cache and pass them to this function, any changes that happened DURING that operation are LOST.

**Affected Screens:**
1. ✅ **FocusModeScreen** - FIXED
2. ⚠️ **TaskDetailScreen** - VULNERABLE
3. ⚠️ **StarredScreen** - VULNERABLE (especially in setTimeout)
4. ⚠️ **PlannedScreen** - VULNERABLE
5. ⚠️ **HistoryScreen** - VULNERABLE
6. ⚠️ **DashboardScreen** - VULNERABLE
7. ✅ **TodayScreen** - SAFE (doesn't use toggleTaskCompletion)

---

## 🐛 The Root Problem

### Design Flaw in `toggleTaskCompletion`:

```javascript
export const toggleTaskCompletion = async (userId, currentTasks, taskId, currentStatus) => {
  const updated = currentTasks.map(t =>
    t.id === taskId ? { ...t, is_completed: newStatus } : t
  );
  
  // ❌ DANGER: Overwrites ENTIRE cache with currentTasks array
  await cacheTasks(userId, updated);
  
  syncToSupabase('tasks', 'update', ...);
  return updated;
};
```

**The Issue:**
- Caller must provide `currentTasks` array
- Function blindly writes this array to cache
- If `currentTasks` is stale, it overwrites fresh data
- Any tasks added/updated AFTER `currentTasks` was loaded are LOST

---

## 📊 Vulnerability Analysis by Screen

### 1. FocusModeScreen ✅ FIXED

**Before Fix:**
```javascript
const completeTaskAndExit = async () => {
  const allTasks = await Storage.get(`tasks_${session.user.id}`);
  // ❌ BUG: If user was in Focus Mode for 10 minutes,
  // allTasks could be missing tasks added during that time
  await toggleTaskCompletion(session.user.id, allTasks, task.id, false);
};
```

**After Fix:**
```javascript
const completeTaskAndExit = async () => {
  const latestTasks = await Storage.get(`tasks_${session.user.id}`) || [];
  const updatedTasks = latestTasks.map(t =>
    t.id === task.id 
      ? { ...t, is_completed: true, completed_at: new Date().toISOString() }
      : t
  );
  await Storage.set(`tasks_${session.user.id}`, updatedTasks);
  syncToSupabase('tasks', 'update', { is_completed: true, ... }, { column: 'id', value: task.id });
};
```

**Status:** ✅ Fixed - No longer uses toggleTaskCompletion

---

### 2. TaskDetailScreen ⚠️ VULNERABLE

**Current Code:**
```javascript
const handleToggleComplete = async () => {
  const newStatus = !task.is_completed;
  setTask(prev => ({ ...prev, is_completed: newStatus }));
  
  // ⚠️ POTENTIAL ISSUE: Fresh load, but...
  const allTasks = await Storage.get(`tasks_${userId}`);
  if (allTasks) await toggleTaskCompletion(userId, allTasks, task.id, task.is_completed);
};
```

**Risk Level:** MEDIUM
- Loads fresh tasks before each toggle
- BUT: If another screen/sync updates cache DURING the toggle operation, changes are lost
- Window is small (~100ms) but possible

**Recommended Fix:**
```javascript
const handleToggleComplete = async () => {
  const newStatus = !task.is_completed;
  setTask(prev => ({ ...prev, is_completed: newStatus, completed_at: newStatus ? new Date().toISOString() : null }));
  
  // Load fresh, update only this task, save back
  const latestTasks = await Storage.get(`tasks_${userId}`) || [];
  const updated = latestTasks.map(t =>
    t.id === task.id 
      ? { ...t, is_completed: newStatus, completed_at: newStatus ? new Date().toISOString() : null }
      : t
  );
  await Storage.set(`tasks_${userId}`, updated);
  await Storage.set('last_local_write_time', Date.now().toString());
  
  syncToSupabase('tasks', 'update',
    { is_completed: newStatus, completed_at: newStatus ? new Date().toISOString() : null },
    { column: 'id', value: task.id }
  );
  
  // Handle reminder & gamification
  if (newStatus && task.reminder_time) cancelTaskReminder(task.id);
  else if (!newStatus && task.reminder_time) scheduleTaskReminder(task.id, task.title, task.reminder_time);
  await Gamification.addXP(userId, newStatus ? 10 : -10);
};
```

---

### 3. StarredScreen 🚨 HIGH RISK

**Current Code:**
```javascript
setTimeout(async () => {
  const updated = tasks.map(...);
  setTasks(updated);
  
  // 🚨 CRITICAL: Loading cache INSIDE setTimeout!
  // 600ms delay = high chance of stale data
  const allTasks = await Storage.get(`tasks_${userId}`);
  if (allTasks) {
    await toggleTaskCompletion(userId, allTasks, taskId, false);
  }
}, 600);
```

**Risk Level:** HIGH
- Loads tasks INSIDE 600ms setTimeout
- Cache could be updated by:
  - Background Supabase fetch
  - Sync queue drain
  - Another screen updating a task
- **Very likely to cause data loss!**

**Recommended Fix:**
```javascript
setTimeout(async () => {
  const completedAt = new Date().toISOString();
  const updated = tasks.map(t =>
    t.id === taskId ? { ...t, is_completed: true, completed_at: completedAt } : t
  );
  setTasks(updated);
  setCompletingTaskIds(prev => prev.filter(id => id !== taskId));
  
  if (userId) {
    // Load fresh RIGHT NOW (not relying on closure)
    const latestTasks = await Storage.get(`tasks_${userId}`) || [];
    const updatedAll = latestTasks.map(t =>
      t.id === taskId ? { ...t, is_completed: true, completed_at: completedAt } : t
    );
    await Storage.set(`tasks_${userId}`, updatedAll);
    await Storage.set('last_local_write_time', Date.now().toString());
    
    syncToSupabase('tasks', 'update',
      { is_completed: true, completed_at: completedAt },
      { column: 'id', value: taskId }
    );
    
    await Gamification.addXP(userId, 25);
  }
}, 600);
```

---

### 4. PlannedScreen ⚠️ SAME AS STARRED

Same setTimeout pattern, same vulnerability, same fix needed.

---

### 5. HistoryScreen ⚠️ VULNERABLE

**Current Code:**
```javascript
const handleRestoreTask = async (task) => {
  const updatedTasks = await toggleTaskCompletion(userId, tasks, task.id, true);
  setTasks(updatedTasks);
};
```

**Risk Level:** MEDIUM
- Uses `tasks` from component state
- If state is stale (not refreshed recently), overwrites fresh cache
- History screen is less frequently used, so lower risk

**Recommended Fix:**
```javascript
const handleRestoreTask = async (task) => {
  // Load fresh tasks
  const latestTasks = await Storage.get(`tasks_${userId}`) || [];
  const updated = latestTasks.map(t =>
    t.id === task.id 
      ? { ...t, is_completed: false, completed_at: null }
      : t
  );
  
  await Storage.set(`tasks_${userId}`, updated);
  await Storage.set('last_local_write_time', Date.now().toString());
  
  syncToSupabase('tasks', 'update',
    { is_completed: false, completed_at: null },
    { column: 'id', value: task.id }
  );
  
  setTasks(updated);
};
```

---

### 6. DashboardScreen ⚠️ VULNERABLE

**Current Code:**
```javascript
const updatedAll = await toggleTaskCompletion(profile.id, allTasks, id, currentStatus);
processTasks(updatedAll);
```

**Risk Level:** MEDIUM
- Uses `allTasks` loaded at screen init
- If user stays on Dashboard for long time, data becomes stale
- Any new tasks added elsewhere will be lost on toggle

**Recommended Fix:**
Same pattern as others - load fresh, update, save.

---

### 7. TodayScreen ✅ SAFE

**Why It's Safe:**
```javascript
const toggleTask = async (id, currentStatus) => {
  if (isCompleting) {
    const taskSnapshot = [...latestTasksRef.current]; // Captured NOW
    setTimeout(() => {
      const updated = taskSnapshot.map(...);
      cacheTasks(userId, updated);
      syncToSupabase('tasks', 'update', ...);
    }, 800);
  }
};
```

**Best Practices Used:**
1. Uses `latestTasksRef.current` (always current)
2. Captures snapshot BEFORE async operations
3. Calls `cacheTasks` directly (not through toggleTaskCompletion)
4. Syncs to Supabase independently
5. No middleman function that could cause issues

**This is the CORRECT pattern!** All screens should follow this.

---

## 🎯 Recommended Solution

### Option 1: Fix toggleTaskCompletion (BREAKING CHANGE)

Change signature to NOT require currentTasks:

```javascript
export const toggleTaskCompletion = async (userId, taskId, currentStatus) => {
  // Load fresh tasks INSIDE the function
  const currentTasks = await Storage.get(`tasks_${userId}`) || [];
  
  const newStatus = !currentStatus;
  const completedAt = newStatus ? new Date().toISOString() : null;
  
  const updated = currentTasks.map(t =>
    t.id === taskId ? { ...t, is_completed: newStatus, completed_at: completedAt } : t
  );
  
  await Storage.set(`tasks_${userId}`, updated);
  await Storage.set('last_local_write_time', Date.now().toString());
  
  syncToSupabase('tasks', 'update',
    { is_completed: newStatus, completed_at: completedAt },
    { column: 'id', value: taskId }
  );
  
  return updated;
};
```

**Pros:**
- Fixes ALL screens at once
- Centralizes the logic
- Prevents future bugs

**Cons:**
- Must update ALL callers
- Changes API signature
- Risky if we miss any caller

---

### Option 2: Fix Each Screen Individually (SAFER)

Follow TodayScreen's pattern in each screen:
1. Load fresh tasks from cache
2. Update only the affected task
3. Save directly to cache
4. Sync to Supabase independently

**Pros:**
- Safer (isolated changes)
- Can test one screen at a time
- No API changes

**Cons:**
- More code duplication
- Harder to maintain
- Easy to miss a screen

---

### Option 3: Hybrid Approach (RECOMMENDED)

1. **Fix toggleTaskCompletion to load fresh data internally**
2. **Keep old signature for backward compatibility**
3. **Gradually migrate screens to new direct pattern**

```javascript
// New safe version
export const toggleTaskCompletion = async (userId, taskId, currentStatus) => {
  const currentTasks = await Storage.get(`tasks_${userId}`) || [];
  // ... rest of logic
};

// Deprecated but still works
export const toggleTaskCompletionLegacy = async (userId, currentTasks, taskId, currentStatus) => {
  console.warn('[DataManager] toggleTaskCompletionLegacy is deprecated - use toggleTaskCompletion instead');
  // ... old logic
};
```

---

## 🚀 Action Plan

### Immediate (Today):
1. ✅ Fix FocusModeScreen (DONE)
2. ⚠️ Fix StarredScreen (HIGH RISK - setTimeout pattern)
3. ⚠️ Fix PlannedScreen (same as Starred)

### Short-term (This Week):
4. Fix TaskDetailScreen
5. Fix HistoryScreen
6. Fix DashboardScreen

### Long-term (Next Sprint):
7. Refactor toggleTaskCompletion to load fresh data internally
8. Deprecate old signature
9. Add TypeScript to catch these issues at compile time
10. Add unit tests for race conditions

---

## 📝 Lessons Learned

1. **Never pass large arrays to mutation functions**
   - Functions should load their own fresh data
   - Or use atomic updates (taskId only)

2. **setTimeout + async storage = danger**
   - Data can become stale during delay
   - Always reload before mutating

3. **Closure captures are stale after async operations**
   - Use refs for current values
   - Or reload from source of truth

4. **Cache-first architecture needs careful synchronization**
   - Race conditions are easy to introduce
   - Need timestamps or versioning

5. **Pattern consistency prevents bugs**
   - TodayScreen's pattern is correct
   - All screens should follow it

---

## ✅ Status

**Fixed:**
- ✅ FocusModeScreen

**Needs Fixing (Priority Order):**
1. 🚨 StarredScreen (HIGH RISK - setTimeout)
2. 🚨 PlannedScreen (HIGH RISK - setTimeout)
3. ⚠️ TaskDetailScreen (MEDIUM RISK)
4. ⚠️ HistoryScreen (MEDIUM RISK)
5. ⚠️ DashboardScreen (MEDIUM RISK)

**Estimated Time:** 2-3 hours for all screens

---

**This is a systemic issue affecting data integrity across the app. Needs immediate attention!** 🚨

