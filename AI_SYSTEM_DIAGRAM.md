# AI System Architecture Diagram

## 🎯 Complete AI Chat & Credit Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER OPENS AI CHAT                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              INITIALIZATION (useEffect)                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. Load Memory                                           │  │
│  │    ├─ Try Supabase Cloud (NEW!)                         │  │
│  │    ├─ Fallback to Local Storage                         │  │
│  │    └─ Cache locally                                      │  │
│  │                                                           │  │
│  │ 2. Load Credits                                          │  │
│  │    ├─ Check if Premium User                             │  │
│  │    │   └─ Yes: Set to 99999999                          │  │
│  │    └─ No: Load from aicredits_{userId}                  │  │
│  │                                                           │  │
│  │ 3. Load Chat History                                     │  │
│  │    └─ Show saved messages or greeting                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    UI READY - SHOW CHAT                         │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  ⚡ {credits} Credits Left              [X Close]        │ │
│  │                                                            │ │
│  │              ╔═══════════════╗                            │ │
│  │              ║   LIQUID      ║                            │ │
│  │              ║    AURA       ║  <- Animated orb           │ │
│  │              ║   OVERLAY     ║                            │ │
│  │              ╚═══════════════╝                            │ │
│  │                                                            │ │
│  │        "Welcome back! How can I help?"                    │ │
│  │                                                            │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │  🎤  Type or tap the mic...             [Send 📤]  │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │  ✨ Build Schedule (Costs 3 ⚡)                    │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
┌───────────────────────────┐  ┌──────────────────────────┐
│   USER SENDS CHAT (1 ⚡)  │  │  USER BUILDS (3 ⚡)      │
└───────────┬───────────────┘  └───────────┬──────────────┘
            │                              │
            ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CREDIT CHECK                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  if (creditsLeft < requiredAmount) {                     │  │
│  │    ❌ Block action                                       │  │
│  │    Show: "Not enough credits" message                   │  │
│  │    return;                                               │  │
│  │  }                                                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  PREPARE API CALL                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ • Gather context (tasks, calendar, memory)               │  │
│  │ • Build system prompt                                    │  │
│  │ • Format messages array                                  │  │
│  │ • Set creditsDeducted = false                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CALL AI API                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  TRY:                                                     │  │
│  │    1️⃣ Gemini API                                         │  │
│  │       ├─ gemini-2.5-flash                               │  │
│  │       ├─ gemini-2.0-flash                               │  │
│  │       └─ gemini-flash-latest                            │  │
│  │                                                           │  │
│  │    2️⃣ Groq API                                           │  │
│  │       ├─ openai/gpt-oss-120b                            │  │
│  │       ├─ llama-3.3-70b-versatile                        │  │
│  │       └─ llama-3.1-8b-instant                           │  │
│  │                                                           │  │
│  │    3️⃣ Mistral API                                        │  │
│  │       └─ mistral-small-latest                           │  │
│  │                                                           │  │
│  │    4️⃣ Cohere API                                         │  │
│  │       └─ command-r                                       │  │
│  │                                                           │  │
│  │    5️⃣ Local Fallback                                     │  │
│  │       └─ buildFallbackSchedule()                        │  │
│  │          (generates from user's tasks)                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SUCCESS PATH                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ✅ Got valid response from AI                            │  │
│  │                                                           │  │
│  │ if (!response._isFallback) {                             │  │
│  │   💰 DEDUCT CREDITS                                      │  │
│  │   ├─ Update local: creditsLeft - amount                 │  │
│  │   ├─ Save to Storage                                     │  │
│  │   ├─ Sync to Supabase                                    │  │
│  │   └─ Set creditsDeducted = true  ⭐ NEW!                │  │
│  │ }                                                         │  │
│  │                                                           │  │
│  │ 📝 Update memory (if changed)                            │  │
│  │ 💬 Show response to user                                 │  │
│  │ 💾 Save to chat history                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DONE ✅                                    │
└─────────────────────────────────────────────────────────────────┘

                    ❌ ERROR PATH ❌
┌─────────────────────────────────────────────────────────────────┐
│                   CATCH BLOCK                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ❌ API call failed / Network error / etc.                │  │
│  │                                                           │  │
│  │ if (creditsDeducted) {  ⭐ NEW!                          │  │
│  │   💰 REFUND CREDITS                                      │  │
│  │   ├─ Update local: creditsLeft + amount                 │  │
│  │   ├─ Save to Storage                                     │  │
│  │   ├─ Sync to Supabase                                    │  │
│  │   └─ Log: "💰 Refunded X credits due to error"          │  │
│  │ }                                                         │  │
│  │                                                           │  │
│  │ 💬 Show error message to user                            │  │
│  │ 💾 Save error to chat history                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                 USER SEES ERROR + REFUND                        │
│  "I lost the AI connection. Please try again."                 │
│  Credits returned: 20 → 21 (or 17 → 20)  ✨                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Daily Credit Reset Flow

```
┌─────────────────────────────────────────────────────────────────┐
│            USER OPENS APP (ANY SCREEN)                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                dataManager.fetchProfile(userId)                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. Fetch profile from Supabase                           │  │
│  │                                                           │  │
│  │ 2. Get today's date                                      │  │
│  │    const today = new Date().toISOString().split('T')[0] │  │
│  │                                                           │  │
│  │ 3. Check if premium user                                 │  │
│  │    if (username === 'terminator' ||                      │  │
│  │        username === 'saxenaanupam2004') {                │  │
│  │      ✨ Set credits to 99999999                          │  │
│  │      ✨ Update Supabase                                  │  │
│  │    }                                                      │  │
│  │                                                           │  │
│  │ 4. Check if reset needed                                 │  │
│  │    else if (last_credit_reset_date !== today) {         │  │
│  │      🔄 Reset credits to 20                              │  │
│  │      📅 Update last_credit_reset_date = today           │  │
│  │      💾 Save to Supabase                                 │  │
│  │    }                                                      │  │
│  │                                                           │  │
│  │ 5. Cache credits locally                                 │  │
│  │    Storage.set('aicredits_userId', credits)             │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 💾 Data Sync Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SUPABASE CLOUD                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  profiles table                                          │  │
│  │  ├─ id: UUID                                             │  │
│  │  ├─ username: TEXT                                       │  │
│  │  ├─ ai_credits: INTEGER                                  │  │
│  │  ├─ ai_memory: TEXT  ⬆️⬇️ Syncs both ways               │  │
│  │  └─ last_credit_reset_date: DATE                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ⬆️ Push   │   ⬇️ Pull
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                   LOCAL STORAGE (AsyncStorage)                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  aicredits_{userId}        → Credit balance              │  │
│  │  aimemory_{userId}         → AI memory (cached)          │  │
│  │  ai_chat_history_{userId}  → Message history             │  │
│  │  profile_{userId}          → User profile (cached)       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   APP STATE (React State)                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  creditsLeft: number       → Displayed in UI             │  │
│  │  userMemory: string        → Used in AI calls            │  │
│  │  messages: array           → Chat conversation           │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ Error Handling Layers

```
Layer 1: INPUT VALIDATION
├─ Check if arrays exist before .map()
├─ Check if objects exist before accessing properties
└─ Validate message format before API calls

Layer 2: API FALLBACKS
├─ Try Gemini → Fail → Try Groq
├─ Try Groq → Fail → Try Mistral
├─ Try Mistral → Fail → Try Cohere
└─ All Fail → Use Local Fallback

Layer 3: CREDIT PROTECTION
├─ Check credits before deduction
├─ Track deductions with boolean flags
└─ Refund if error occurs after deduction

Layer 4: USER FEEDBACK
├─ Show specific error messages
├─ Log errors to console for debugging
└─ Maintain chat history even on errors

Layer 5: DATA PERSISTENCE
├─ Try cloud sync → Fail → Use local cache
├─ Try write to Supabase → Fail → Queue for retry
└─ Always cache locally as backup
```

---

## 🎯 Key Design Principles

1. **Fail Gracefully**: Always have a fallback
2. **Fair Billing**: Only charge for success
3. **Data Safety**: Sync both cloud + local
4. **User Trust**: Transparent credit system
5. **Offline First**: Work without internet
6. **Premium Respect**: Unlimited for VIPs

---

**Visual Legend:**
- ✅ Success path
- ❌ Error path
- 💰 Credit operation
- 🔄 Reset/Sync operation
- ⬆️ Upload to cloud
- ⬇️ Download from cloud
- ⭐ New improvement
- 💾 Storage operation
- 📝 State update
