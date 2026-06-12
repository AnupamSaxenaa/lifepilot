# 🤖 START HERE — For AI Agents & LLMs

> **Quick onboarding for any AI assistant working on LifePilot**

---

## 📖 Read These 3 Files (In Order)

### 1. **`AI_AGENT_HANDOFF.md`** (10 min read) ⭐
**What:** Complete project overview  
**Why:** Understand tech stack, architecture, recent changes, and rules  
**When:** Right now (before anything else)

### 2. **`ARCHITECTURE.md`** (5 min read) ⭐
**What:** Offline-first data architecture  
**Why:** CRITICAL before touching any data code  
**When:** Before making any data-related changes

### 3. **`AGENTS.md`** (2 min read)
**What:** Agent-specific development instructions  
**Why:** Quick rules for coding on this project  
**When:** Before making code changes

---

## ⚡ Super Quick Summary

**Project:** LifePilot — Personal productivity app (Android)  
**Tech:** React Native (Expo SDK 56) + Supabase + AsyncStorage  
**Architecture:** Offline-first (like Microsoft To Do)  
**Status:** Development (vjasper1.0) → Ready for production v1.0.0

---

## 🚨 Critical Rules (Don't Skip!)

### 1. Data Operations
```javascript
// ❌ NEVER DO THIS
const { data } = await supabase.from('tasks').select('*');

// ✅ ALWAYS DO THIS
import { loadTasks } from '../lib/dataManager';
const tasks = await loadTasks(userId, onFresh);
```

### 2. Offline-First Pattern
1. Update local state FIRST (optimistic UI)
2. Save to AsyncStorage (cache)
3. Sync to Supabase in background (via syncQueue)

### 3. Recent Changes (June 12, 2026)
- ✅ Fixed 7 critical bugs
- ✅ Added production update channel
- ✅ Fixed drag & drop jitter
- See `CODE_FIXES_COMPLETED.md` for details

### 4. Security Warning
🚨 AI API keys are exposed in client code (`AIEngine.js`)  
**TODO:** Move to Supabase Edge Functions (HIGH PRIORITY)

---

## 📁 Key Files You'll Work With

| File | Purpose | When to Use |
|------|---------|------------|
| `src/lib/dataManager.js` | Data operations | ALL data reads/writes |
| `src/lib/syncQueue.js` | Offline sync | Background (automatic) |
| `src/lib/AIEngine.js` | AI providers | AI features |
| `src/screens/*` | UI screens | Building features |
| `src/components/*` | Reusable UI | Building features |

---

## 🎯 Common Tasks Quick Reference

### Adding a New Screen
1. Create file in `src/screens/`
2. Import from `dataManager.js`
3. Follow offline-first pattern
4. Add route to `App.js`

### Fixing a Bug
1. Check `CODE_AUDIT_FIXES.md` for known issues
2. Read `ARCHITECTURE.md` to understand patterns
3. Make the fix
4. Test offline mode

### Publishing Update
```bash
# JavaScript changes (OTA)
eas update --channel production --message "Bug fix"

# Native changes (APK)
eas build --platform android --profile production
```

---

## 📚 Full Documentation Index

**All docs are listed in:** `DOCS_INDEX.md`

**Most useful:**
- `ARCHITECTURE_VISUAL.md` — Flowcharts and diagrams
- `UPDATE_SYSTEM_ANALYSIS.md` — OTA + APK updates
- `CODE_FIXES_COMPLETED.md` — Recent bug fixes

---

## ✅ Quick Health Check

Before starting work:

```bash
# 1. Dependencies installed?
npm install

# 2. Environment variables set?
# Check .env has SUPABASE_URL and API keys

# 3. Dev server running?
npx expo start

# 4. Can build?
eas build --platform android --profile preview --local

# 5. Diagnostics clean?
npx expo-doctor
```

---

## 🎓 5-Minute Crash Course

### What is LifePilot?
Task management app with AI assistant, offline support, and gamification.

### How does data work?
1. User action → Update local state (instant UI)
2. Save to AsyncStorage (cache)
3. Sync to Supabase (background)
4. If offline, queue for later

### What's the tech stack?
- **Frontend:** React Native (Expo)
- **Backend:** Supabase (PostgreSQL)
- **Cache:** AsyncStorage
- **AI:** Gemini, Groq, Mistral, Cohere
- **Updates:** Expo Updates (OTA)

### What's the current status?
- Development version (vjasper1.0)
- All critical bugs fixed (June 12)
- Ready for production (after moving API keys to backend)

---

## 🚀 You're Ready!

**Next steps:**
1. ✅ Read `AI_AGENT_HANDOFF.md` (complete context)
2. ✅ Read `ARCHITECTURE.md` (data patterns)
3. ✅ Read `AGENTS.md` (quick rules)
4. ✅ Start coding! 🎉

**When in doubt:**
- Check `DOCS_INDEX.md` for all documentation
- Read `ARCHITECTURE.md` for data questions
- Read `UPDATE_SYSTEM_ANALYSIS.md` for deployment

---

**Good luck! The docs have everything you need.** 🚀

**Pro tip:** Bookmark these 3 files:
1. `AI_AGENT_HANDOFF.md`
2. `ARCHITECTURE.md`
3. `DOCS_INDEX.md`

