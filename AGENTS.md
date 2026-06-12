# LifePilot — Agent Instructions

## ⚠️ CRITICAL: Read ARCHITECTURE.md FIRST

Before making ANY code changes, read `/ARCHITECTURE.md` in the project root.
It defines the **offline-first data architecture** that EVERY screen must follow.

**For new AI agents:** Also read `/AI_AGENT_HANDOFF.md` for complete project context.

## Quick Rules

1. **NEVER call Supabase directly from screens** — use `src/lib/dataManager.js`
2. **All mutations go through SyncQueue** — `src/lib/syncQueue.js`  
3. **Always update local state FIRST** (optimistic UI), then sync in background
4. **Cache everything** to AsyncStorage via `src/utils/storage.js`
5. **Show cached data instantly** — never block UI with a loading spinner if cache exists

## Key Files

- `ARCHITECTURE.md` — Full architecture documentation (START HERE)
- `src/lib/dataManager.js` — Central data API for all screens
- `src/lib/syncQueue.js` — Offline mutation queue with retry
- `src/lib/supabase.js` — Supabase client (DO NOT use directly in screens)
- `src/utils/storage.js` — AsyncStorage wrapper

## Tech Stack

- React Native (Expo SDK 56)
- Supabase (PostgreSQL backend + auth)
- AsyncStorage (local phone storage)
- Zustand (state — available but minimal use currently)
- NativeWind/TailwindCSS (styling)
- Lucide React Native (icons)
