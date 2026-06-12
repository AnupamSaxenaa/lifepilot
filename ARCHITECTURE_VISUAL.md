# LifePilot — Visual Architecture Guide

> **Visual diagrams and flowcharts to understand the system quickly**

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER DEVICE (Android)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              React Native UI Layer                        │  │
│  │  (Screens, Components, Navigation)                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          ↓↑                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Business Logic Layer                         │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │  │
│  │  │ dataManager │  │  AIEngine    │  │  repeatEngine  │  │  │
│  │  │   .js       │  │    .js       │  │     .js        │  │  │
│  │  └─────────────┘  └──────────────┘  └────────────────┘  │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │  │
│  │  │ syncQueue   │  │ gamification │  │  notifications │  │  │
│  │  │   .js       │  │    .js       │  │     .js        │  │  │
│  │  └─────────────┘  └──────────────┘  └────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          ↓↑                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Local Storage Layer (AsyncStorage)              │  │
│  │                                                            │  │
│  │  • Tasks Cache         • Profile Cache                    │  │
│  │  • Sync Queue          • Gamification Data                │  │
│  │  • AI Memory           • Sort Preferences                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                             ↓↑
                    (Network Connection)
                             ↓↑
┌─────────────────────────────────────────────────────────────────┐
│                         CLOUD SERVICES                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Supabase Backend                       │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │  │
│  │  │ PostgreSQL  │  │  Auth        │  │  Storage       │  │  │
│  │  │ (Database)  │  │  (Users)     │  │  (Avatars)     │  │  │
│  │  └─────────────┘  └──────────────┘  └────────────────┘  │  │
│  │                                                            │  │
│  │  Tables: tasks, profiles, app_versions, lists, alarms     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    AI Providers                           │  │
│  │                                                            │  │
│  │  • Gemini 2.5 Flash (primary)                             │  │
│  │  • Groq (fallback)                                        │  │
│  │  • Mistral (fallback)                                     │  │
│  │  • Cohere (fallback)                                      │  │
│  │                                                            │  │
│  │  ⚠️ Keys currently in client (move to Edge Functions!)    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Expo Updates (OTA)                     │  │
│  │                                                            │  │
│  │  • JavaScript bundle updates                              │  │
│  │  • No APK rebuild required                                │  │
│  │  • Channel: preview, production                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 Data Flow: Reading Tasks

```
User Opens Screen
       │
       ├─────────────────────────────────────────────────┐
       │                                                  │
       ▼                                                  ▼
1. Load from AsyncStorage                      Background Process
   (INSTANT — 0ms)                            (Non-blocking)
       │                                                  │
       ▼                                                  ▼
2. Show Cached Data                          Drain Sync Queue
   in UI                                      (retry pending writes)
       │                                                  │
       │                                                  ▼
       │                                        Fetch from Supabase
       │                                                  │
       │                                      ┌───────────┴───────────┐
       │                                      │                       │
       │                                   Success                  Offline
       │                                      │                       │
       │                                      ▼                       ▼
       │                            Update AsyncStorage          No-op
       │                                      │                  (use cache)
       │                                      ▼
       │                            Compare timestamps
       │                                      │
       │                          ┌───────────┴───────────┐
       │                          │                       │
       │                    No Local Writes         Local Writes
       │                          │                  Detected
       │                          ▼                       │
       │                    Update UI               Skip Update
       │                    (silent)                (preserve edits)
       │                          │                       │
       └──────────────────────────┴───────────────────────┘
                                  │
                                  ▼
                         User Sees Latest Data
```

---

## 📝 Data Flow: Writing Tasks

```
User Action (e.g., toggle task)
       │
       ▼
1. Update React State
   (Optimistic UI — INSTANT)
       │
       ▼
2. Save to AsyncStorage
   (Cache — survives restart)
       │
       ▼
3. Call syncToSupabase()
       │
       ├─────────────────────────────────────┐
       │                                      │
    Online                                 Offline
       │                                      │
       ▼                                      ▼
Execute Immediately              Queue to AsyncStorage
       │                          (will retry later)
       │                                      │
       ▼                                      │
Supabase Mutation                            │
       │                                      │
   ┌───┴────┐                                │
   │        │                                │
Success   Error                              │
   │        │                                │
   ▼        ▼                                │
  Done   Queue it                            │
           │                                 │
           └─────────────────────────────────┘
                         │
                         ▼
              Stored in Sync Queue
                         │
                         ▼
              (Wait for connectivity)
                         │
                         ▼
              User goes back online
                         │
                         ▼
              drainSyncQueue() called
                         │
                         ▼
              Replay all pending ops
                         │
                         ▼
              ✅ Synced to Supabase
```

---

## 🔄 Update System Flow

```
App Launch
    │
    ▼
Check Force Update (Supabase)
    │
    ├─────────────────────────────────────┐
    │                                      │
Required                               Not Required
    │                                      │
    ▼                                      ▼
Show ForceUpdateBlocker          Check OTA Update (Expo)
    │                                      │
    ▼                              ┌───────┴────────┐
Download APK                       │                 │
    │                         Available          Not Available
    ▼                              │                 │
Install APK                        ▼                 ▼
    │                     Download JS Bundle    Continue to App
    ▼                              │
Restart                            ▼
    │                      Show "Update Ready"
    ▼                              │
Updated! ✅                        ▼
                           User Restarts App
                                   │
                                   ▼
                           Apply OTA Update
                                   │
                                   ▼
                              Updated! ✅
```

---

## 🧠 AI Assistant Flow

```
User Sends Message
       │
       ▼
Check AI Credits
       │
       ├─────────────────────────────────────┐
       │                                      │
   Sufficient                            Insufficient
       │                                      │
       ▼                                      ▼
Deduct Credits                        Show "Out of Credits"
       │                                      │
       ▼                                      ▼
Fetch User Memory                         Return
(AsyncStorage + Supabase)
       │
       ▼
Fetch Calendar Events (if enabled)
       │
       ▼
Build Context (memory + calendar + message)
       │
       ▼
Call AI Provider
       │
       ├───────┬──────┬──────┐
       │       │      │      │
    Gemini   Groq  Mistral Cohere
       │       │      │      │
       └───────┴──────┴──────┘
                 │
         ┌───────┴────────┐
         │                │
      Success          Error
         │                │
         ▼                ▼
   Update Memory    Refund Credits
         │                │
         ▼                ▼
   Save to Cache    Show Fallback
         │            Response
         ▼
   Sync to Supabase
         │
         ▼
   Return Response ✅
```

---

## 🎮 Gamification System

```
Task Completed
       │
       ▼
Load Gamification State
(userId, XP, level, streak, lastActiveDate)
       │
       ▼
Check Streak
       │
       ├────────────────────────────┐
       │                             │
Today = Last Active        Today ≠ Yesterday
       │                             │
       ▼                             ▼
No Change                    Was Yesterday?
       │                             │
       │                    ┌────────┴────────┐
       │                    │                 │
       │                   Yes                No
       │                    │                 │
       │                    ▼                 ▼
       │              Increment          Reset Streak
       │                Streak               to 0
       │                    │                 │
       └────────────────────┴─────────────────┘
                            │
                            ▼
                       Add XP (+10)
                            │
                            ▼
                   Floor XP at 0 (no negative)
                            │
                            ▼
                   Calculate Level
                   (level = floor(XP / 100) + 1)
                            │
                            ▼
                   Increment Daily Count
                            │
                            ▼
                   Save State to AsyncStorage
                            │
                            ▼
                   Background Sync to Supabase
                            │
                            ▼
                   Update UI (XP bar, level) ✅
```

---

## 📁 File Dependency Map

```
Screens (UI Layer)
    │
    ├─→ TodayScreen.js
    │      ├─→ dataManager.js ──→ syncQueue.js ──→ supabase.js
    │      ├─→ gamification.js ──→ storage.js
    │      ├─→ repeatEngine.js ──→ storage.js
    │      └─→ AIAuraOverlay.js ──→ AIEngine.js ──→ [AI Providers]
    │
    ├─→ StarredScreen.js
    │      └─→ dataManager.js ──→ syncQueue.js ──→ supabase.js
    │
    ├─→ SettingsScreen.js
    │      ├─→ dataManager.js
    │      ├─→ updateManager.js ──→ expo-updates
    │      └─→ versionChecker.js ──→ supabase.js
    │
    └─→ DashboardScreen.js
           ├─→ dataManager.js
           ├─→ gamification.js
           └─→ repeatEngine.js


Core Libraries (Business Logic)
    │
    ├─→ dataManager.js        # Central data API (all CRUD operations)
    │      ├─→ storage.js             # AsyncStorage wrapper
    │      ├─→ syncQueue.js           # Offline mutation queue
    │      └─→ supabase.js            # Supabase client
    │
    ├─→ syncQueue.js          # Offline sync queue with retry
    │      └─→ supabase.js
    │
    ├─→ AIEngine.js           # AI provider multiplexer
    │      └─→ [External APIs: Gemini, Groq, Mistral, Cohere]
    │
    └─→ updateManager.js      # OTA update checker
           └─→ expo-updates


Utilities (Helper Functions)
    │
    ├─→ storage.js            # AsyncStorage wrapper
    ├─→ notifications.js      # Local push notifications
    ├─→ repeatEngine.js       # Recurring task reset
    ├─→ gamification.js       # XP/level/streak logic
    ├─→ versionChecker.js     # Force update check
    ├─→ calendarSync.js       # Calendar integration
    └─→ apkDownloader.js      # APK download + install
```

---

## 🔐 Security & Auth Flow

```
App Launch
    │
    ▼
Check Session (Supabase)
    │
    ├─────────────────────────────────────┐
    │                                      │
Session Exists                      No Session
    │                                      │
    ▼                                      ▼
Load User Profile                   Show Auth Screen
    │                                      │
    ▼                                      ▼
Load Cached Data                    User Logs In
    │                                      │
    ▼                                      ▼
Check Credit Reset              Supabase Auth (email/password)
    │                                      │
    ├──────────────────┐                  ▼
    │                  │            Create Session Token
Last Reset ≠ Today   Premium              │
    │                User                 ▼
    ▼                  │           Save to SecureStore
Reset to 20           ▼                   │
Credits        Set Unlimited              ▼
    │            (99999999)          Fetch Profile
    │                  │                   │
    └──────────────────┴───────────────────┘
                       │
                       ▼
              Load App Data ✅
                       │
                       ▼
              Auto-refresh Token
              (Supabase handles)
```

---

## 🎯 Key Data Structures

### Task Object
```javascript
{
  id: "uuid-or-bigint",
  user_id: "uuid",
  title: "Task title",
  is_completed: false,
  is_important: true,
  due_date: "2026-06-15T00:00:00Z",
  reminder_time: "2026-06-15T09:00:00Z",
  repeat_rule: "daily" | "weekly" | null,
  quadrant: "urgent-important",
  list_id: "uuid" | null,
  order_index: 0,
  starred_order_index: null,
  subtasks: [],
  notes: "Task notes",
  created_at: "2026-06-12T10:00:00Z",
  completed_at: null
}
```

### Sync Queue Entry
```javascript
{
  id: "1718194800_abc123",
  table: "tasks",
  operation: "insert" | "update" | "delete",
  data: { /* mutation payload */ },
  filter: { column: "id", value: "123" },
  createdAt: "2026-06-12T10:00:00Z",
  retryCount: 0
}
```

### Gamification State
```javascript
{
  xp: 250,
  level: 3,
  streak: 7,
  lastActiveDate: "2026-06-12",
  tasksCompletedToday: 5
}
```

---

## 📱 Screen Hierarchy

```
App (ErrorBoundary)
 │
 ├─ AuthStack (if not logged in)
 │   ├─ WelcomeScreen
 │   ├─ SignInScreen
 │   └─ SignUpScreen
 │
 └─ MainStack (if logged in)
     │
     ├─ BottomTabs
     │   ├─ Dashboard
     │   ├─ Today
     │   ├─ Lists
     │   └─ Settings
     │
     └─ Modal/Stack Screens
         ├─ TaskDetail
         ├─ CustomListScreen
         ├─ HistoryScreen
         ├─ StarredScreen
         ├─ PromisesScreen
         ├─ ProfileScreen
         ├─ QuadrantScreen
         └─ AlarmScreen
```

---

## 🚀 Build & Deploy Pipeline

```
Development
    │
    ├─→ npx expo start (dev server)
    │      │
    │      └─→ Hot reload (instant)
    │
    ▼
Code Changes
    │
    ├──────────────────────────────────────┐
    │                                       │
JavaScript Only                    Native Changes
    │                                       │
    ▼                                       ▼
OTA Update                         Build APK (EAS)
    │                                       │
    ├─→ eas update                         ├─→ eas build
    │      --channel preview               │      --platform android
    │      --message "Bug fix"             │      --profile production
    │                                       │
    ▼                                       ▼
Expo Servers                        EAS Build Servers
    │                                       │
    │ (5 minutes)                           │ (10-15 minutes)
    │                                       │
    ▼                                       ▼
Users Get Update                    Download APK
on Next App Open                         │
    │                                       ▼
    ▼                               Upload to CDN/Server
✅ Updated                                  │
                                            ▼
                                   Update Supabase
                                   app_versions Table
                                            │
                                            ▼
                                   Users See Force Update
                                            │
                                            ▼
                                   Download + Install
                                            │
                                            ▼
                                   ✅ Updated
```

---

## 🎨 Component Hierarchy Example (TodayScreen)

```
TodayScreen
 │
 ├─ SafeAreaView
 │   │
 │   ├─ Header
 │   │   ├─ Title
 │   │   ├─ Sync Indicator
 │   │   └─ Menu Button
 │   │
 │   ├─ NestableDraggableFlatList
 │   │   │
 │   │   └─ TaskCard (repeated)
 │   │       ├─ GripHandle (drag)
 │   │       ├─ Checkbox
 │   │       ├─ TaskContent
 │   │       │   ├─ Title
 │   │       │   ├─ Meta (date, reminder, repeat)
 │   │       │   └─ Subtasks (progress)
 │   │       └─ StarButton
 │   │
 │   └─ FloatingActionButton (+ Add Task)
 │
 ├─ TaskDetailModal (conditional)
 │
 ├─ AIAuraOverlay (conditional)
 │   ├─ Chat History
 │   ├─ Input Field
 │   └─ Send Button
 │
 └─ UpdateProgress (conditional)
```

---

**This visual guide complements:**
- `ARCHITECTURE.md` (text-based architecture)
- `AI_AGENT_HANDOFF.md` (complete project overview)
- `AGENTS.md` (development instructions)

**Last Updated:** June 12, 2026

