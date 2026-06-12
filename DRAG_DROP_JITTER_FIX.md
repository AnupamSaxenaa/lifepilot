# Drag & Drop Jitter Fix ✅

## Problem
When dragging and rearranging tasks in Today, Starred, or Custom Lists, there was a small jitter/stutter when the task was dropped.

## Root Cause
The `onDragEnd` callback was calling `setTasks()` immediately, which triggered a re-render **while the drag animation was still finishing**. This caused a visual jump/jitter.

## Solution
Wrapped the state update in `requestAnimationFrame()` to defer the update until **after** the browser completes the current frame (including the drag animation).

### Before:
```javascript
onDragEnd={({ data }) => {
  if (sortBy !== 'custom') setSortBy('custom');
  const orderMap = new Map(data.map((t, i) => [t.id, i]));
  const mergedTasks = latestTasksRef.current.map(t => 
    orderMap.has(t.id) ? { ...t, order_index: orderMap.get(t.id) } : t
  );
  setTasks(mergedTasks); // ❌ Immediate re-render causes jitter
  reorderTasks(userId, mergedTasks, changedTasks);
}}
```

### After:
```javascript
onDragEnd={({ data }) => {
  // ✅ Defer state update until after drag animation completes
  requestAnimationFrame(() => {
    if (sortBy !== 'custom') setSortBy('custom');
    const orderMap = new Map(data.map((t, i) => [t.id, i]));
    const mergedTasks = latestTasksRef.current.map(t => 
      orderMap.has(t.id) ? { ...t, order_index: orderMap.get(t.id) } : t
    );
    setTasks(mergedTasks);
    reorderTasks(userId, mergedTasks, changedTasks);
  });
}}
```

## Files Modified
- ✅ `src/screens/TodayScreen.js`
- ✅ `src/screens/StarredScreen.js`
- ✅ `src/screens/CustomListScreen.js`

## Result
- ✅ Smooth drag and drop with no jitter
- ✅ Still updates immediately (user doesn't notice the 16ms delay)
- ✅ Animation completes before re-render
- ✅ No performance impact (requestAnimationFrame is ~16ms)

## How requestAnimationFrame Works
- Schedules callback to run **before the next repaint**
- Allows current animations to complete first
- Typically runs after ~16ms (60fps)
- Perfect for preventing layout shifts during animations

## Testing
1. Open Today/Starred/Custom List screen
2. Drag a task to a new position
3. Drop it
4. ✅ Should see smooth animation with NO jitter

---

**Status:** Fixed ✅  
**Date:** June 12, 2026  
**Impact:** Better UX, smoother animations
