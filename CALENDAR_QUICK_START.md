# Calendar Sync - Quick Start Guide

## 🎯 What It Does

Calendar sync lets the AI see your device calendar events and schedule around them automatically.

---

## 🚀 Quick Setup (30 seconds)

### Step 1: Enable in Settings
1. Open LifePilot app
2. Tap sidebar menu (≡)
3. Scroll to **"Device Sync"**
4. Toggle **"Local Calendars"** ON
5. Tap **"Allow"** when prompted
6. ✅ Done! Should show "Synced"

### Step 2: Test It
1. Go to **Today** screen
2. Tap AI chat icon (✨)
3. Ask: **"What's on my calendar?"**
4. AI should list your events!

---

## 💬 What You Can Ask

### Calendar Questions:
- "What's on my calendar?"
- "Do I have any meetings tomorrow?"
- "When is my next event?"
- "What's my schedule for this week?"
- "Am I free at 3 PM today?"

### Smart Scheduling:
- Click "Build Schedule" → AI automatically avoids your calendar events
- AI won't schedule tasks during busy times
- AI suggests free time slots

---

## 🐛 Troubleshooting

### "No permission"
**Fix**: Settings → LifePilot → Permissions → Calendar → Allow

### "No calendars found"
**Fix**: Add a calendar account in device Settings → Accounts

### "Not seeing my events"
**Check**:
- Events are within next 7 days
- Calendar is synced to device
- Calendar app is set up

### Still not working?
**Debug**:
1. Open React Native debugger
2. Look for `[CalendarSync]` logs
3. Check what the issue is
4. Share logs with dev team

---

## 📊 What Calendar Data Is Used

### Automatically Fetched:
- ✅ Event title
- ✅ Start time
- ✅ End time
- ✅ Date
- ✅ Location (if set)
- ✅ Notes (if set)
- ✅ Which calendar it's from

### Time Range:
- **Today** to **7 days from now**
- Checked **before every AI interaction**

### What's NOT Sent:
- ❌ Past events (only future)
- ❌ Events beyond 7 days
- ❌ Your calendar credentials
- ❌ Attendee lists

---

## 🎯 How AI Uses It

### When You Chat:
1. AI fetches calendar events
2. Can answer questions about your schedule
3. Provides context-aware responses

### When You Build Schedule:
1. AI fetches calendar events
2. Avoids scheduling over events
3. Finds free time slots
4. Respects busy periods

### Example:
```
Your Calendar:
- Team Meeting: 2-3 PM

AI Schedule Generated:
✓ 9:00 AM - Deep Work
✓ 11:00 AM - Email Review
✓ 1:00 PM - Lunch
⛔ 2:00 PM - [Team Meeting - Calendar Event]
✓ 3:30 PM - Project Work
```

---

## 🔒 Privacy

### Data Storage:
- ✅ Events read from YOUR device
- ✅ Sent ONLY to AI for context
- ✅ NOT stored on servers
- ✅ NOT shared with third parties

### Permissions:
- ✅ You control calendar access
- ✅ Can revoke anytime in device settings
- ✅ Only reads events (doesn't modify)

---

## 📱 Platform Notes

### iOS:
- Works with iCloud Calendar
- Works with Google Calendar (if added to iOS)
- Works with Outlook (if added to iOS)

### Android:
- Works with Google Calendar
- Works with Samsung Calendar
- Works with Outlook Calendar
- Requires READ_CALENDAR permission

---

## 💡 Pro Tips

1. **Keep calendar updated** - AI fetches fresh data every time
2. **Add event details** - Location and notes help AI understand context
3. **Use descriptive titles** - "Team Meeting" better than "Meeting"
4. **Block focus time** - Add calendar events for deep work
5. **Add travel time** - AI sees these and schedules around them

---

## 🎉 You're All Set!

Calendar sync is now active. The AI will:
- ✅ See your calendar events
- ✅ Answer schedule questions
- ✅ Avoid booking conflicts
- ✅ Suggest optimal times

**Try asking: "What's on my calendar?" to test it!** 💬
