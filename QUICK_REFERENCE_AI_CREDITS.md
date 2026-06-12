# Quick Reference: AI Credit System

## 💰 Credit Costs

| Action | Cost | Refunded on Error? |
|--------|------|-------------------|
| Chat message | 1 credit | ✅ Yes |
| Build Schedule | 3 credits | ✅ Yes |
| Fallback response | 0 credits | N/A |

## 👑 Premium Users

Usernames with unlimited credits:
- `terminator`
- `saxenaanupam2004`

Credits: **99999999** (unlimited)

## 🔄 Daily Reset

- Resets to **20 credits** every day
- Happens when user loads profile in `dataManager.js`
- Uses `last_credit_reset_date` to track
- Syncs to Supabase automatically

## 🗄️ Storage Keys

| Key | Purpose |
|-----|---------|
| `aicredits_{userId}` | Current credit balance |
| `aimemory_{userId}` | AI conversation memory |
| `ai_chat_history_{userId}` | Chat message history |
| `profile_{userId}` | User profile data |

## 🔧 Key Functions

### In `AIAuraOverlay.js`:

```javascript
// Deduct credits
await deductCredits(1);  // Chat
await deductCredits(3);  // Build Schedule

// Refund credits on error
await refundCredits(1);  // Chat refund
await refundCredits(3);  // Schedule refund
```

## 🐛 Debugging

### Check Credits:
```javascript
const credits = await Storage.get(`aicredits_${userId}`);
console.log('Credits:', credits);
```

### Check Memory:
```javascript
const memory = await Storage.get(`aimemory_${userId}`);
console.log('Memory:', memory);
```

### Check Supabase:
```sql
SELECT username, ai_credits, ai_memory, last_credit_reset_date 
FROM profiles 
WHERE id = 'user-uuid-here';
```

## 🎨 UI Elements

**Credit Badge** (Top of AI overlay):
```
⚡ {creditsLeft} Credits Left
```

**Low Credit Warning** (Build Schedule < 3):
```
⚡ Not enough AI credits (costs 3).
Please check back tomorrow!
```

**Out of Credits** (Chat < 1):
```
You have run out of AI credits for today! 
Please check back tomorrow.
```

## 🔍 Console Logs to Watch

| Log | Meaning |
|-----|---------|
| `🧠 Memory synced from cloud` | Memory loaded from Supabase |
| `🧠 Memory Updated & Synced` | Memory saved to cloud |
| `💰 Refunded X credits due to error` | Credits returned after error |
| `✅ Plan generated` | Schedule built successfully |
| `⚠️ Using local fallback schedule` | AI failed, using local generation |

## 🚨 Error Messages

| User Message | What Happened |
|-------------|---------------|
| "I lost the AI connection for a moment" | API call failed, credits refunded |
| "All AI services are temporarily unavailable" | All providers failed, check API keys |
| "You have run out of AI credits" | User at 0 credits, blocked |
| "You need at least 3 AI credits" | User has < 3, build blocked |

## 📊 Credit Flow Logic

```javascript
// BEFORE API call
if (creditsLeft < requiredAmount) {
  // Block action
  return;
}

let creditsDeducted = false;

try {
  const response = await aiCall();
  
  if (!response._isFallback) {
    await deductCredits(amount);
    creditsDeducted = true;
  }
} catch (error) {
  if (creditsDeducted) {
    await refundCredits(amount); // ✨ NEW!
  }
}
```

## ✅ Testing Checklist

- [ ] Chat with AI (should cost 1 credit)
- [ ] Build schedule (should cost 3 credits)
- [ ] Trigger error by disabling internet (should refund)
- [ ] Use fallback (should cost 0 credits)
- [ ] Check premium user (should show 99999999)
- [ ] Verify daily reset (check next day)
- [ ] Test memory sync (logout/login)

## 🔗 Related Files

- `src/components/AIAuraOverlay.js` - UI and credit logic
- `src/lib/AIEngine.js` - AI providers and fallbacks
- `src/lib/dataManager.js` - Daily reset logic
- `src/lib/supabase.js` - Database client
- `src/utils/storage.js` - Local storage wrapper

## 📞 Quick Commands

### Reset credits manually:
```javascript
await Storage.set('aicredits_userId', '20');
```

### Clear memory:
```javascript
await Storage.remove('aimemory_userId');
```

### Force premium:
```javascript
await Storage.set('aicredits_userId', '99999999');
```

## 🎯 Pro Tips

1. **Always check `_isFallback`** before deducting credits
2. **Always track deductions** with boolean flags
3. **Always refund on errors** in catch blocks
4. **Always sync to both** local storage AND Supabase
5. **Always test with internet off** to verify refunds work

---

**Need help? Check:**
- `SESSION_SUMMARY.md` - Full session details
- `AI_CREDIT_IMPROVEMENTS.md` - Implementation details
- `ARCHITECTURE.md` - Overall app architecture
