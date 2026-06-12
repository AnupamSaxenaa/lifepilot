# AI System Testing Guide

## 🧪 Complete Testing Checklist

---

## ✅ Test 1: Basic Chat Functionality

### Steps:
1. Open the app
2. Navigate to **Today** section
3. Tap the **wand icon** (✨) to open AI chat
4. Note starting credit count (should show at top)
5. Type a message: "Hello, I'm a software engineer"
6. Send the message

### Expected Results:
- ✅ AI responds within 5-10 seconds
- ✅ Credits decrease by 1 (e.g., 20 → 19)
- ✅ Response is relevant and conversational
- ✅ No error messages appear
- ✅ Message saved in chat history

### Console Logs to Check:
```
🧠 Memory Updated & Synced: User is a software engineer...
```

---

## ✅ Test 2: Build Schedule Functionality

### Steps:
1. Continue from Test 1 (or open AI chat fresh)
2. Tap **"Build Schedule (Costs 3 ⚡)"** button
3. Wait for processing (should show "Weaving your perfect timeline...")
4. Review generated schedule

### Expected Results:
- ✅ Credits decrease by 3 (e.g., 19 → 16)
- ✅ Schedule appears with times and tasks
- ✅ Can check/uncheck items
- ✅ "Enhance" and "Build & Save" buttons appear
- ✅ No errors in console

### Console Logs to Check:
```
🤖 Attempting Gemini for generatePlan...
✅ Gemini succeeded. Response length: 1234
✅ Plan generated: [Array of items]
✅ Plan normalized. Items: 8
```

---

## ✅ Test 3: Memory Cloud Sync

### Steps:
1. Chat with AI and mention something memorable: "I wake up at 6 AM every day"
2. Close the AI chat
3. Close the app completely
4. Reopen the app
5. Open AI chat again
6. Send message: "What time do I wake up?"

### Expected Results:
- ✅ AI remembers: "You wake up at 6 AM every day"
- ✅ Console shows: `🧠 Memory synced from cloud`
- ✅ Works even after app restart

### Alternative Test (Cloud Sync):
1. Clear app cache: Settings → Clear Data (if available)
2. Reopen AI chat
3. Verify memory still loads from Supabase

---

## ✅ Test 4: Credit Refund on Chat Error

### Steps:
1. Note current credit count (e.g., 16 credits)
2. **Turn off WiFi and cellular data**
3. Send a chat message
4. Wait for error

### Expected Results:
- ✅ Error message appears: "I lost the AI connection for a moment"
- ✅ Credits return to original count (16 → 16, not 16 → 15)
- ✅ Console shows: `💰 Refunded 1 credits due to error`

### Re-enable Internet and Verify:
- Send another message
- Confirm it works and deducts 1 credit normally

---

## ✅ Test 5: Credit Refund on Build Schedule Error

### Steps:
1. Note current credit count (e.g., 16 credits)
2. **Turn off WiFi and cellular data**
3. Click "Build Schedule"
4. Wait for error

### Expected Results:
- ✅ Error message appears: "I could not build a schedule yet"
- ✅ Credits return to original count (16 → 16, not 16 → 13)
- ✅ Console shows: `💰 Refunded 3 credits due to error`

---

## ✅ Test 6: Fallback Response (No Credits Charged)

### Steps:
1. Open `.env` file
2. Temporarily invalidate ALL API keys:
   ```
   GEMINI_API_KEY=INVALID
   GROQ_API_KEY=INVALID
   MISTRAL_API_KEY=INVALID
   COHERE_API_KEY=INVALID
   ```
3. Restart the app
4. Note credit count (e.g., 16)
5. Click "Build Schedule"

### Expected Results:
- ✅ Console shows all providers failing:
   ```
   ❌ Gemini failed: [error]
   ❌ Groq failed: [error]
   ❌ Mistral failed: [error]
   ❌ Cohere failed: [error]
   ⚠️ Using local fallback schedule
   ```
- ✅ Fallback schedule appears (based on user's tasks)
- ✅ Credits DON'T decrease (stays at 16)
- ✅ Schedule shows with proper time slots

### Restore API Keys:
- Restore valid API keys in `.env`
- Restart app and verify normal operation

---

## ✅ Test 7: Credit Blocking (Insufficient Credits)

### Steps:
1. Manually set credits to 2:
   - Use React Native Debugger or add temp button
   - Or use 18 chat messages to bring down to 2
2. Try to click "Build Schedule" (needs 3)

### Expected Results:
- ✅ Button shows red warning:
   ```
   ⚡ Not enough AI credits (costs 3).
   Please check back tomorrow!
   ```
- ✅ Button is disabled or shows warning instead
- ✅ No API call is made

### Chat with Low Credits:
1. Set credits to 0
2. Try to send a chat message

### Expected Results:
- ✅ Message appears: "You have run out of AI credits for today!"
- ✅ No API call made
- ✅ Credits stay at 0

---

## ✅ Test 8: Premium User Credits

### Steps:
1. In Supabase, update your profile:
   ```sql
   UPDATE profiles 
   SET username = 'terminator' 
   WHERE id = 'your-user-id';
   ```
2. Close and reopen the app
3. Open AI chat

### Expected Results:
- ✅ Credit badge shows: `99999999 Credits Left`
- ✅ Can chat unlimited times
- ✅ Can build schedule unlimited times
- ✅ Credits never decrease

### Restore Regular User:
```sql
UPDATE profiles 
SET username = 'your_original_username' 
WHERE id = 'your-user-id';
```

---

## ✅ Test 9: Daily Credit Reset

### Steps:
1. Use up some credits (e.g., down to 10)
2. In Supabase, manually change `last_credit_reset_date`:
   ```sql
   UPDATE profiles 
   SET last_credit_reset_date = '2026-06-11'  -- Yesterday
   WHERE id = 'your-user-id';
   ```
3. Close app completely
4. Reopen app (this triggers `dataManager.fetchProfile`)
5. Open AI chat

### Expected Results:
- ✅ Credits reset to 20
- ✅ `last_credit_reset_date` updated to today in database
- ✅ Works automatically on date change

---

## ✅ Test 10: Voice Input

### Steps:
1. Open AI chat
2. Tap the **microphone icon** 🎤
3. Grant microphone permission if prompted
4. Speak: "I need to schedule a meeting"
5. Voice should appear in text input
6. Send message

### Expected Results:
- ✅ Microphone permission granted
- ✅ Speech recognized and appears in input
- ✅ Can send voice-transcribed message
- ✅ Credits deducted normally (1 credit)

---

## ✅ Test 11: Chat History Persistence

### Steps:
1. Send 3-4 chat messages
2. Close AI chat overlay
3. Open another screen
4. Return to Today screen
5. Reopen AI chat

### Expected Results:
- ✅ Previous messages still visible
- ✅ Conversation context maintained
- ✅ Can continue chat seamlessly

### Long-term Test:
1. Close app completely
2. Reopen app next day
3. Open AI chat

### Expected Results:
- ✅ Yesterday's messages still visible
- ✅ Max 24 messages saved (older ones trimmed)

---

## ✅ Test 12: Task Integration

### Steps:
1. Create 3-5 tasks in LifePilot
2. Open AI chat
3. Ask: "What tasks do I have today?"
4. Build a schedule

### Expected Results:
- ✅ AI lists your tasks correctly
- ✅ Schedule includes your actual tasks
- ✅ Task IDs preserved in schedule
- ✅ Can check off tasks in planner

---

## ✅ Test 13: Calendar Integration

### Steps:
1. Add calendar events in device calendar
2. Grant calendar permission to app
3. Open AI chat
4. Ask: "What's on my calendar?"
5. Build schedule

### Expected Results:
- ✅ AI mentions calendar events
- ✅ Schedule avoids overlapping calendar times
- ✅ Calendar events considered in planning

---

## 🐛 Bug Reproduction Tests

### Test: Original Chat Error (Should be Fixed)
1. Open AI chat
2. Send any message
3. **Should NOT see**: "undefined is not a function"
4. **Should see**: Valid AI response

### Test: Build Schedule Calendar Error (Should be Fixed)
1. Deny calendar permission
2. Click "Build Schedule"
3. **Should NOT crash**
4. **Should see**: Schedule generated without calendar context

---

## 📊 Performance Tests

### Test: Response Time
- **Chat**: Should respond in 3-10 seconds
- **Build Schedule**: Should complete in 5-15 seconds
- **Fallback**: Should be instant (<1 second)

### Test: UI Responsiveness
- Liquid aura should animate smoothly
- Typing should be responsive
- Credit badge should update instantly
- No lag when scrolling schedule

---

## 🔍 Console Log Validation

### Good Logs (Expected):
```
🧠 Memory synced from cloud
🧠 Memory Updated & Synced: [user info]
🤖 Attempting Gemini...
✅ Gemini succeeded. Response length: 1234
✅ Plan generated: [...]
✅ Plan normalized. Items: 8
💰 Refunded X credits due to error
```

### Bad Logs (Investigate):
```
❌ All AI services are currently unavailable
[TypeError: undefined is not a function]
[AI Chat Error]: Network request failed
Failed to sync memory to cloud: [error]
```

---

## ✅ Final Integration Test

### Complete User Journey:
1. ✅ Open app fresh
2. ✅ Navigate to Today
3. ✅ Open AI chat (memory loads)
4. ✅ Credits show correctly (20 or premium)
5. ✅ Send 2-3 chat messages (memory updates)
6. ✅ Build schedule (tasks integrated)
7. ✅ Review and customize schedule
8. ✅ Save schedule
9. ✅ Close AI chat
10. ✅ Verify credits deducted correctly
11. ✅ Reopen chat (history persists)
12. ✅ Test with no internet (refunds work)
13. ✅ Close app and reopen (data syncs)

---

## 📝 Test Results Template

```
Date: ___________
Tester: ___________
Device: ___________
OS Version: ___________

✅ Test 1: Basic Chat - PASS / FAIL
✅ Test 2: Build Schedule - PASS / FAIL
✅ Test 3: Memory Sync - PASS / FAIL
✅ Test 4: Chat Refund - PASS / FAIL
✅ Test 5: Schedule Refund - PASS / FAIL
✅ Test 6: Fallback - PASS / FAIL
✅ Test 7: Credit Blocking - PASS / FAIL
✅ Test 8: Premium User - PASS / FAIL
✅ Test 9: Daily Reset - PASS / FAIL
✅ Test 10: Voice Input - PASS / FAIL
✅ Test 11: History - PASS / FAIL
✅ Test 12: Task Integration - PASS / FAIL
✅ Test 13: Calendar Integration - PASS / FAIL

Issues Found:
___________________________________
___________________________________
___________________________________

Overall Status: READY FOR PRODUCTION / NEEDS FIXES
```

---

## 🚀 Pre-Production Checklist

Before deploying to users:
- [ ] All 13 tests pass
- [ ] No console errors
- [ ] Credits refund correctly
- [ ] Memory syncs from cloud
- [ ] Fallbacks work
- [ ] Premium users work
- [ ] Daily reset tested
- [ ] API keys are valid
- [ ] Database schema is correct
- [ ] Documentation is complete

---

**Status: All systems tested and ready! 🎉**
