# Calendar Permission Fix - "Please enable calendar access" Error

## 🐛 Problem

You're seeing "Please enable calendar access in your OS settings" even after granting permission.

---

## 🔍 Root Causes

### Cause 1: App Needs Rebuild (MOST COMMON)
**Issue**: Native permissions require app rebuild after adding expo-calendar

**Symptoms**:
- Permission dialog doesn't show
- Permission appears granted in toggle but fails in actual use
- Console shows permission denied

**Solution**:
```bash
# Clean and rebuild Android app
cd /Users/praveenkumarsaxena/Desktop/lifepilot

# Clean
npx expo prebuild --clean

# Rebuild dev client (if using)
npx expo run:android

# OR build fresh APK
eas build --profile development --platform android
```

---

### Cause 2: Permission State Not Refreshed
**Issue**: Component shows "Synced" but permission was actually denied

**Symptoms**:
- Toggle shows "Synced" 
- But permission check returns false
- Console logs show `status: 'denied'`

**Solution**: Added permission verification in GlassSidebar with detailed logging

---

### Cause 3: Android Permission Dialog Not Showing
**Issue**: Android sometimes needs both READ and WRITE permissions

**Symptoms**:
- Permission dialog never appears
- Silent failure

**Solution**: Already configured in app.json:
```json
"permissions": [
  "android.permission.READ_CALENDAR",
  "android.permission.WRITE_CALENDAR"
]
```

---

## 🔧 Fixes Applied

### Fix 1: Enhanced Permission Logging
```javascript
// BEFORE:
const { status } = await Calendar.getCalendarPermissionsAsync();
return status === 'granted';

// AFTER:
const { status, canAskAgain, granted } = await Calendar.getCalendarPermissionsAsync();
console.log('[CalendarSync] Permission check:', { status, canAskAgain, granted });
return status === 'granted';
```

**Shows**:
- Current permission status
- Whether we can ask again
- Explicit granted flag

---

### Fix 2: Request with Pre-Check
```javascript
// Check if already granted before requesting
const currentStatus = await Calendar.getCalendarPermissionsAsync();
if (currentStatus.status === 'granted') {
  return true; // Already have it!
}
// Then request...
```

**Avoids**: Redundant permission requests

---

### Fix 3: Verification After Grant
```javascript
// In GlassSidebar after granting:
setTimeout(async () => {
  const verified = await isCalendarConnected();
  console.log('[GlassSidebar] Verification check:', verified);
  if (!verified) {
    console.warn('WARNING: Permission verification failed!');
  }
}, 500);
```

**Detects**: Permission grant failures immediately

---

### Fix 4: Comprehensive Error Logging
```javascript
catch (err) {
  console.error('[CalendarSync] Failed:', err);
  console.error('[CalendarSync] Error name:', err.name);
  console.error('[CalendarSync] Error message:', err.message);
  console.error('[CalendarSync] Error stack:', err.stack);
}
```

**Helps**: Debug exact failure point

---

## 🧪 Debugging Steps

### Step 1: Check Console Logs

Open React Native debugger and look for these logs:

#### Good (Working):
```
[GlassSidebar] Calendar toggle tapped, current state: false
[GlassSidebar] Requesting calendar permissions...
[CalendarSync] Current permission status: { status: 'undetermined', canAskAgain: true, granted: false }
[CalendarSync] Requesting calendar permission...
[CalendarSync] Permission request result: { status: 'granted', canAskAgain: true, granted: true }
[GlassSidebar] Permission granted: true
[GlassSidebar] Verification check: true ✅
```

#### Bad (Not Working):
```
[GlassSidebar] Calendar toggle tapped, current state: false
[GlassSidebar] Requesting calendar permissions...
[CalendarSync] Current permission status: { status: 'undetermined', canAskAgain: true, granted: false }
[CalendarSync] Requesting calendar permission...
[CalendarSync] Permission request result: { status: 'denied', canAskAgain: false, granted: false } ❌
[GlassSidebar] Permission granted: false
```

---

### Step 2: Manually Check Device Settings

#### Android:
```
Settings → Apps → LifePilot → Permissions → Calendar
Should show: "Allowed"
```

If it shows "Denied" or "Not allowed":
1. Tap it
2. Change to "Allow"
3. Restart LifePilot app
4. Try AI chat again

---

### Step 3: Test Permission Directly

Add temporary test button in Settings:

```javascript
<TouchableOpacity onPress={async () => {
  const check1 = await Calendar.getCalendarPermissionsAsync();
  console.log('Current:', check1);
  
  const request = await Calendar.requestCalendarPermissionsAsync();
  console.log('After request:', request);
  
  const check2 = await Calendar.getCalendarPermissionsAsync();
  console.log('Verification:', check2);
  
  Alert.alert('Debug', JSON.stringify(check2, null, 2));
}}>
  <Text>Debug Calendar Permission</Text>
</TouchableOpacity>
```

This will show you the exact permission state.

---

## 🚀 Complete Fix Procedure

### Option A: Quick Fix (If Using Dev Client)
```bash
# 1. Clear native cache
cd android && ./gradlew clean && cd ..

# 2. Rebuild
npx expo run:android

# 3. Test permission flow
```

---

### Option B: Full Rebuild (Recommended)
```bash
# 1. Clean everything
rm -rf node_modules
rm -rf android
rm -rf ios
npm install

# 2. Prebuild native dirs
npx expo prebuild --clean

# 3. Run on device
npx expo run:android

# 4. Test permission
```

---

### Option C: Fresh APK Build
```bash
# Build production APK with EAS
eas build --profile production --platform android

# Or development profile
eas build --profile development --platform android

# Install fresh APK on device
# Test permission from scratch
```

---

## 📱 Testing After Fix

### Test 1: Permission Grant
1. Uninstall old app
2. Install new build
3. Open Settings sidebar
4. Toggle "Local Calendars"
5. **Should see permission dialog**
6. Grant permission
7. **Should see "Connected" alert**
8. Check logs for verification

### Test 2: Permission Persists
1. Close app completely
2. Reopen app
3. Open Settings sidebar
4. **Toggle should show "Synced"**
5. Open AI chat
6. Ask "What's on my calendar?"
7. **Should NOT show permission error**

### Test 3: Actual Calendar Fetch
1. Add test event in device calendar
2. Open AI chat
3. Ask "What's on my calendar?"
4. Check console logs:
```
[CalendarSync] Starting getConnectedCalendarsPrompt...
[CalendarSync] Has permission: true ✅
[CalendarSync] Fetching calendars...
[CalendarSync] Found calendars: 1
[CalendarSync] Calendar details: [{ id: '1', title: 'My Calendar', source: 'Local' }]
[CalendarSync] Fetching events from [date] to [date]
[CalendarSync] Found events: 1
[CalendarSync] Event titles: ['Test Event']
```

---

## 🎯 Expected Console Output

### When Working Correctly:
```
[GlassSidebar] Calendar toggle tapped, current state: false
[CalendarSync] Current permission status: { status: 'undetermined' }
[CalendarSync] Requesting calendar permission...
[CalendarSync] Permission request result: { status: 'granted' }
[GlassSidebar] Permission granted: true
[GlassSidebar] Verification check: true

// Later when AI fetches:
[CalendarSync] Starting getConnectedCalendarsPrompt...
[CalendarSync] Permission check: { status: 'granted', granted: true }
[CalendarSync] Has permission: true
[CalendarSync] Fetching calendars...
[CalendarSync] Found calendars: 2
[CalendarSync] Using calendar IDs: ['1', '2']
[CalendarSync] Found events: 3
[CalendarSync] Returning calendar context with 3 events
```

---

## 🔑 Key Points

1. **Native permissions require app rebuild** - Most common issue
2. **Check logs first** - They'll tell you exactly what's failing
3. **Verify in device settings** - Manual check is reliable
4. **Test with fresh install** - Eliminates cached permission issues
5. **Both READ and WRITE needed** - Android requirement

---

## 💡 Still Not Working?

### Last Resort Checklist:
- [ ] App was rebuilt after adding expo-calendar
- [ ] Device settings show calendar permission granted
- [ ] Console shows `status: 'granted'`
- [ ] No "Permission denied" errors in console
- [ ] Calendar app has events to fetch
- [ ] Events are within next 7 days

If all checked and still failing:
```bash
# Nuclear option - complete clean slate
rm -rf node_modules android ios
npm install
npx expo prebuild --clean
npx expo run:android

# Then test immediately after install
```

---

## 📝 Quick Command Reference

```bash
# Check expo-calendar is installed
npm list expo-calendar

# Rebuild Android
npx expo run:android

# Clean rebuild
npx expo prebuild --clean && npx expo run:android

# Check Android manifest
cat android/app/src/main/AndroidManifest.xml | grep CALENDAR

# Build fresh APK
eas build --profile development --platform android
```

---

**Most likely fix: Rebuild the app with `npx expo run:android`** 🔄
