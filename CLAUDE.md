# LifePilot — Claude Instructions

Read ARCHITECTURE.md first. All data operations must use src/lib/dataManager.js (offline-first).
Never call Supabase directly from screens. All writes go through src/lib/syncQueue.js.
