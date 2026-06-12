# LifePilot — Personal Productivity App

> **For AI Agents & Developers:** Read `AI_AGENT_HANDOFF.md` first for complete project context.

LifePilot is an offline-first task management app with AI assistant, calendar sync, and gamification built with React Native (Expo) and Supabase.

---

## 🤖 For AI Agents & LLMs

**Start here in this order:**

1. **`AI_AGENT_HANDOFF.md`** — Complete project overview, architecture, recent changes
2. **`ARCHITECTURE.md`** — Offline-first data architecture (CRITICAL — read before touching data code)
3. **`AGENTS.md`** — Specific instructions for agent development

**Quick Rules:**
- Use `src/lib/dataManager.js` for ALL data operations (never call Supabase directly)
- Follow offline-first pattern: local state → cache → sync
- Test offline mode for every feature
- Read existing docs before asking questions

**Current Status:** Development (vjasper1.0) → Ready for production v1.0.0 (after API key fix)

---

## 🚀 For Human Developers

### Quick Start

1. Install dependencies
   ```bash
   npm install
   ```

2. Set up environment variables
   ```bash
   cp .env.example .env
   # Add your API keys to .env
   ```

3. Start development server
   ```bash
   npx expo start
   ```

4. Press `a` for Android emulator or scan QR code on device

### Tech Stack
- **Framework:** React Native (Expo SDK 56)
- **Backend:** Supabase (PostgreSQL + Auth + Storage)
- **Local Storage:** AsyncStorage
- **Styling:** NativeWind (TailwindCSS)
- **State:** React hooks + useRef
- **Updates:** Expo Updates (OTA)

### Key Features
- ✅ Offline-first task management
- ✅ AI assistant (Gemini, Groq, Mistral, Cohere)
- ✅ Calendar integration
- ✅ Recurring tasks
- ✅ Gamification (XP, levels, streaks)
- ✅ OTA + APK force updates
- ✅ Dark theme

---

## 📁 Project Structure

```
src/
├── screens/          # All app screens (Today, Starred, Settings, etc.)
├── components/       # Reusable UI components
├── lib/             
│   ├── dataManager.js    # ⭐ Central data API (USE THIS)
│   ├── syncQueue.js      # Offline sync queue
│   ├── supabase.js       # Supabase client
│   └── AIEngine.js       # AI providers
└── utils/            # Utility functions (storage, notifications, etc.)
```

---

## 🔧 Development Commands

```bash
# Start development server
npx expo start

# Build preview APK
eas build --platform android --profile preview

# Publish OTA update
eas update --channel preview --message "Bug fix"

# Check for issues
npx expo-doctor

# Clear cache
npx expo start --clear
```

---

## 📚 Documentation

**Essential:**
- `AI_AGENT_HANDOFF.md` — For AI agents (complete overview)
- `ARCHITECTURE.md` — Data architecture
- `AGENTS.md` — Agent instructions
- `BUILD_GUIDE.md` — Android build instructions (JDK 17 required)

**Reference:**
- `UPDATE_SYSTEM_ANALYSIS.md` — OTA + APK update system
- `CODE_FIXES_COMPLETED.md` — Recent bug fixes (June 12, 2026)
- `DRAG_DROP_JITTER_FIX.md` — Drag & drop improvements
- `CALENDAR_FIX_SUMMARY.md` — Calendar sync fixes

**Testing:**
- `TESTING_GUIDE_AI.md` — Testing AI features
- `QUICK_REFERENCE_AI_CREDITS.md` — AI credit system

---

### ⚠️ Android APK Build Instructions

**Important:** Use JDK 17 for building APKs (JDK 25 will fail).

See `BUILD_GUIDE.md` for detailed instructions.

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

⚠️ **Security Note:** API keys should be moved to backend before production (see AI_AGENT_HANDOFF.md).

---

## 🧪 Testing

### Test Accounts (Premium)
- **terminator** — Unlimited AI credits
- **saxenaanupam2004** — Unlimited AI credits

### Current Build
- Version: vjasper1.0 (development)
- Platform: Android only
- EAS Project: f79f9e16-1938-4c95-a8db-cc580b62f081

---

## 🎯 Development Workflow

1. **Before starting:** Read `ARCHITECTURE.md` and `AGENTS.md`
2. **While coding:** Follow offline-first pattern, use `dataManager.js`
3. **Before committing:** Test offline mode, check diagnostics
4. **After changes:** Update docs if architecture changed

---

## 🚨 Known Issues

**Critical:**
- 🔴 API keys exposed in client code (move to Edge Functions)

**Medium:**
- 🟡 Repeat engine midnight bug
- 🟡 No offline indicator banner

See `CODE_AUDIT_FIXES.md` for complete list (23 issues).

---

## 📞 Support

**For Questions:**
- Check documentation first (`AI_AGENT_HANDOFF.md`)
- Review `ARCHITECTURE.md` for data-related questions
- See `UPDATE_SYSTEM_ANALYSIS.md` for update system

**Expo Resources:**
- [Expo documentation](https://docs.expo.dev/)
- [EAS Build](https://docs.expo.dev/build/introduction/)
- [Expo Updates](https://docs.expo.dev/versions/latest/sdk/updates/)

**Supabase:**
- [Supabase Docs](https://supabase.com/docs)
- [Edge Functions](https://supabase.com/docs/guides/functions)

---

## ⚡ Quick Health Check

```bash
# Dependencies OK?
npm install

# Server running?
npx expo start

# Can build?
eas build --platform android --profile preview --local

# Diagnostics clean?
npx expo-doctor
```

---

**Last Updated:** June 12, 2026  
**Status:** Development → Production Ready (after API key fix)  
**License:** Proprietary
