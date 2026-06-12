# 🤖 LifePilot — AI Agent Handoff Document

> **For AI Assistants, LLMs, and Code Agents**
> 
> This document provides EVERYTHING you need to know to work on LifePilot.
> Read this FIRST before making any code changes.

---

## 📋 Quick Context

**What is LifePilot?**  
A personal productivity app (Android) with AI assistant, offline-first task management, calendar sync, and gamification.

**Tech Stack:**
- React Native (Expo SDK 56)
- Supabase (PostgreSQL + Auth + Storage)
- AsyncStorage (offline cache)
- NativeWind/TailwindCSS (styling)
- Expo Updates (OTA updates)

**Current Status:** Development (version "vjasper1.0")  
**Target:** Production v1.0.0  
**Platform:** Android (iOS later)

---

## 🎯 Critical Rules — READ FIRST

### 1. ⚠️ ALWAYS Read These Files First:
1. **`ARCHITECTURE.md`** — Offline-first data architecture (CRITICAL)
2. **`AGENTS.md`** — Agent-specific instructions
3. **This file** — Project overview

### 2. 🚨 Data Architecture (Non-Negotiable)

**NEVER call Supabase directly from screens!**

```javascript
// ❌ WRONG — Don't do this!
const { data } = await supabase.from('tasks').select('*');

// ✅ CORRECT — Use dataManager
import { loadTasks } from '../lib/dataManager';
const tasks = await loadTasks(userId, onFresh);
```

**Why?** LifePilot is offline-first. All data operations go through:
- `src/lib/dataManager.js` — Central data API
- `src/lib/syncQueue.js` — Offline mutation queue
- `src/utils/storage.js` — AsyncStorage wrapper

**Pattern:**
1. Update local state FIRST (optimistic UI)
2. Save to AsyncStorage (cache)
3. Sync to Supabase via syncQueue (background)

### 3. 🔐 Security

**CRITICAL:** AI API keys are currently exposed in client code!
- Location: `src/lib/AIEngine.js` + `.env`
- Risk: Can be extracted from APK
- **TODO:** Move to Supabase Edge Functions (HIGH PRIORITY)

### 4. ⚡ Recent Changes (June 12, 2026)

**Fixed:**
- ✅ Error boundary added (no more white screen crashes)
- ✅ Task toggle race condition fixed
- ✅ Cache overwrite race fixed
- ✅ Sync queue expiration (7 days)
- ✅ Negative XP bug fixed
- ✅ userId validation added to all functions
- ✅ Drag & drop jitter fixed
- ✅ Production update channel added

**See:** `CODE_FIXES_COMPLETED.md` for details

---

## 📁 Project Structure

```
lifepilot/
├── src/
│   ├── screens/           # All app screens
│   │   ├── TodayScreen.js
│   │   ├── StarredScreen.js
│   │   ├── CustomListScreen.js
│   │   ├── SettingsScreen.js
│   │   └── ... (15+ screens)
│   │
│   ├── components/        # Reusable UI components
│   │   ├── ErrorBoundary.js
│   │   ├── AIAuraOverlay.js
│   │   ├── TaskCard.js
│   │   └── ...
│   │
│   ├── lib/              # Core business logic
│   │   ├── dataManager.js     # ⭐ Data API (USE THIS!)
│   │   ├── syncQueue.js       # Offline sync queue
│   │   ├── supabase.js        # Supabase client
│   │   └── AIEngine.js        # AI providers (Gemini, Groq, etc.)
│   │
│   └── utils/            # Utility functions
│       ├── storage.js         # AsyncStorage wrapper
│       ├── notifications.js   # Push notifications
│       ├── repeatEngine.js    # Recurring tasks
│       ├── gamification.js    # XP/levels/streaks
│       ├── updateManager.js   # OTA updates
│       ├── versionChecker.js  # Force update check
│       └── calendarSync.js    # Calendar integration
│
├── assets/               # Images, fonts, icons
├── .env                  # Environment variables (API keys)
├── app.json             # Expo config
├── eas.json             # Build config
├── package.json         # Dependencies
│
└── Documentation/        # All .md files
    ├── ARCHITECTURE.md        # ⭐ Read this first!
    ├── AGENTS.md              # Agent instructions
    ├── CODE_FIXES_COMPLETED.md
    ├── UPDATE_SYSTEM_ANALYSIS.md
    └── ... (20+ docs)
```

---

## 🗺️ Feature Map

### Core Features

| Feature | Files | Status |
|---------|-------|--------|
| **Task Management** | `dataManager.js`, `TodayScreen.js`, `syncQueue.js` | ✅ Stable |
| **AI Assistant** | `AIEngine.js`, `AIAuraOverlay.js` | ✅ Working (keys exposed) |
| **Calendar Sync** | `calendarSync.js`, `TodayScreen.js` | ✅ Fixed (June 12) |
| **Offline Mode** | `syncQueue.js`, `dataManager.js` | ✅ Production-ready |
| **Gamification** | `gamification.js`, `DashboardScreen.js` | ✅ Fixed (no negative XP) |
| **OTA Updates** | `updateManager.js`, `App.js` | ✅ Configured |
| **Force Updates** | `versionChecker.js`, `ForceUpdateBlocker.js` | ✅ Configured |
| **Notifications** | `notifications.js`, `AlarmManager.js` | ✅ Working |
| **Recurring Tasks** | `repeatEngine.js` | ⚠️ Has midnight bug |
| **Drag & Drop** | `TodayScreen.js`, `StarredScreen.js` | ✅ Fixed (no jitter) |

---

## 🔑 Key Concepts

### 1. Offline-First Architecture

**READ:** `ARCHITECTURE.md` for full details

**Summary:**
- Data loads from local cache FIRST (instant UI)
- Supabase fetch happens in BACKGROUND
- UI updates silently when fresh data arrives
- Writes are optimistic (local state → cache → sync)
- Failed syncs are queued and retried

### 2. AI Credit System

**Location:** `AIEngine.js`, `AIAuraOverlay.js`, `dataManager.js`

**How it works:**
- Users get 20 AI credits per day
- Chat costs 1 credit, Build Schedule costs 3 credits
- Premium users (terminator, saxenaanupam2004) get unlimited
- Credits reset daily via `loadProfile()` in dataManager
- Refunded if API call fails after deduction

**Providers:**
- Gemini 2.5 Flash (primary)
- Groq (fallback)
- Mistral (fallback)
- Cohere (fallback)

### 3. Update System

**OTA Updates (JavaScript changes):**
```bash
eas update --channel production --message "Bug fix"
```
- Instant deployment
- No APK rebuild
- Users get update on next app open

**APK Force Updates (Native changes):**
```bash
eas build --platform android --profile production
```
- Requires APK rebuild
- User must download + install
- Checked via Supabase `app_versions` table

**READ:** `UPDATE_SYSTEM_ANALYSIS.md` for full details

### 4. Data Flow Example

```javascript
// User toggles a task
toggleTask(taskId) {
  // 1. Update React state (optimistic)
  const updated = tasks.map(t => 
    t.id === taskId ? { ...t, is_completed: true } : t
  );
  setTasks(updated);  // ⚡ Instant UI update

  // 2. Cache to AsyncStorage
  await cacheTasks(userId, updated);

  // 3. Sync to Supabase (background, queued if offline)
  syncToSupabase('tasks', 'update', 
    { is_completed: true }, 
    { column: 'id', value: taskId }
  );
}
```

---

## 🎨 UI/UX Patterns

### Theme
- **Background:** Pure black (#000000)
- **Primary:** Purple (#A78BFA)
- **Text:** White (#FFFFFF) / Gray variants
- **Cards:** Dark gray with subtle borders

### Components
- Use `lucide-react-native` for icons
- Use NativeWind classes for styling
- All screens use `SafeAreaView`
- Loading states show cached data + subtle refresh indicator

### Navigation
- Bottom tabs: Dashboard, Today, Lists, Settings
- Stack navigator for detail screens
- Back gestures enabled

---

## 🐛 Known Issues

| Issue | Severity | Status | Fix Needed |
|-------|----------|--------|------------|
| API keys exposed | 🔴 CRITICAL | Open | Move to Edge Functions |
| Repeat engine midnight bug | 🟡 Medium | Open | Fix timestamp check |
| No offline indicator | 🟡 Medium | Open | Add banner |
| Storage defaults missing | 🟢 Low | Open | Add fallback values |

**See:** `CODE_AUDIT_FIXES.md` for complete list (23 issues)

---

## 🧪 Testing

### Run Development Server
```bash
npx expo start
```

### Build Preview APK
```bash
eas build --platform android --profile preview
```

### Test OTA Updates
```bash
# 1. Make code change
# 2. Publish update
eas update --channel preview --message "Test"
# 3. Restart app
```

### Check Diagnostics
```bash
npx expo-doctor
```

---

## 📚 Documentation Index

**Must Read:**
- `ARCHITECTURE.md` — Data architecture
- `AGENTS.md` — Agent instructions
- `CODE_FIXES_COMPLETED.md` — Recent fixes

**Reference:**
- `UPDATE_SYSTEM_ANALYSIS.md` — Update system deep dive
- `UPDATES_QUICK_REFERENCE.md` — Update commands
- `CALENDAR_FIX_SUMMARY.md` — Calendar sync fixes
- `AI_CREDIT_IMPROVEMENTS.md` — AI credit system
- `DRAG_DROP_JITTER_FIX.md` — Drag & drop fix
- `SAFETY_IMPROVEMENTS_SUMMARY.md` — Safety improvements

**Guides:**
- `TESTING_GUIDE_AI.md` — Testing AI features
- `QUICK_REFERENCE_AI_CREDITS.md` — AI credit reference

---

## 🚀 Common Tasks

### Adding a New Screen with Data

1. Create screen file in `src/screens/`
2. Import from dataManager:
   ```javascript
   import { loadTasks, cacheTasks } from '../lib/dataManager';
   ```
3. Follow offline-first pattern (see ARCHITECTURE.md)
4. Add navigation route in `App.js`

### Modifying Task Data Structure

1. ⚠️ Requires APK rebuild (native schema change)
2. Update Supabase table via SQL migration
3. Update TypeScript types (if using)
4. Update `dataManager.js` functions
5. Clear AsyncStorage cache for testing

### Adding New AI Feature

1. Add function to `AIEngine.js`
2. Handle credit deduction in caller
3. Add error handling + refund logic
4. Test with all 4 providers (Gemini, Groq, Mistral, Cohere)

### Publishing Update

**JS changes:**
```bash
eas update --channel production --message "Your message"
```

**Native changes:**
```bash
# 1. Update version in app.json
# 2. Build APK
eas build --platform android --profile production
# 3. Update Supabase app_versions table
```

---

## 🔐 Environment Variables

Required in `.env`:
```bash
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
EXPO_PUBLIC_GEMINI_API_KEY=AIzaSyxxx...
EXPO_PUBLIC_GROQ_API_KEY=gsk_xxx...
EXPO_PUBLIC_MISTRAL_API_KEY=xxx...
EXPO_PUBLIC_COHERE_API_KEY=xxx...
```

⚠️ **Security Note:** API keys should NOT be in client code. Move to backend before production.

---

## 🎯 Development Workflow

### Before Starting Work:
1. Read `ARCHITECTURE.md`
2. Read `AGENTS.md`
3. Check `CODE_FIXES_COMPLETED.md` for recent changes
4. Pull latest code
5. Run `npm install` if dependencies changed

### While Working:
1. Follow offline-first pattern
2. Use `dataManager.js` for all data operations
3. Add userId validation to new functions
4. Test offline mode
5. Check diagnostics after changes

### Before Committing:
1. Test on device/emulator
2. Check for TypeScript/ESLint errors
3. Verify no console errors
4. Test offline → online transition
5. Update documentation if architecture changed

---

## 🤝 How to Help

### High Priority:
1. 🚨 **Move API keys to Supabase Edge Functions** (critical security)
2. Fix repeat engine midnight bug
3. Add offline indicator banner
4. Add unit tests for critical functions

### Medium Priority:
5. Add TypeScript for type safety
6. Improve error messages
7. Add loading states where missing
8. Optimize bundle size

### Low Priority:
9. Add analytics tracking
10. Improve accessibility
11. Add deep linking
12. iOS support

---

## 📞 Support

**User Accounts (Premium/Testing):**
- `terminator` - Unlimited AI credits
- `saxenaanupam2004` - Unlimited AI credits

**Testing App:**
- Current build: vjasper1.0 (development)
- Platform: Android
- Expo project ID: f79f9e16-1938-4c95-a8db-cc580b62f081

---

## ✅ Quick Health Check

Before making changes, verify:

```bash
# Dependencies installed?
npm install

# Dev server running?
npx expo start

# Can build?
eas build --platform android --profile preview --local

# Diagnostics clean?
npx expo-doctor

# Supabase connected?
# Check .env has EXPO_PUBLIC_SUPABASE_URL and ANON_KEY
```

---

## 🎓 Learning Resources

**Offline-First:**
- Microsoft To Do architecture (similar pattern)
- Google Tasks offline sync
- React Query (similar caching strategy)

**Expo:**
- [Expo Updates docs](https://docs.expo.dev/versions/latest/sdk/updates/)
- [EAS Build docs](https://docs.expo.dev/build/introduction/)

**Supabase:**
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase Auth](https://supabase.com/docs/guides/auth)

---

## 📝 Changelog

**June 12, 2026:**
- Fixed 7 critical bugs (see CODE_FIXES_COMPLETED.md)
- Added production update channel
- Fixed drag & drop jitter
- Added userId validation to all functions
- Fixed sync queue expiration
- Fixed negative XP bug

**Earlier:**
- Fixed calendar sync permissions
- Fixed AI chat connection errors
- Improved AI credit system
- Added memory cloud sync

---

## 🎯 TL;DR for AI Agents

**3 Rules:**
1. Read `ARCHITECTURE.md` before touching data code
2. Use `dataManager.js` — never call Supabase directly
3. Follow offline-first: local state → cache → sync

**Don't:**
- ❌ Call Supabase from screens
- ❌ Show loading spinners if cache exists
- ❌ Assume user is online
- ❌ Forget to validate userId

**Do:**
- ✅ Update local state first (optimistic UI)
- ✅ Cache everything to AsyncStorage
- ✅ Use syncQueue for all writes
- ✅ Test offline mode

**When in doubt:** Check `ARCHITECTURE.md` or ask!

---

**Last Updated:** June 12, 2026  
**Architecture Version:** 2.0 (offline-first)  
**Status:** Development → Production Ready (after API key fix)

**For other AI agents:** Read this file + `ARCHITECTURE.md` + `AGENTS.md` = you're good to go! 🚀

