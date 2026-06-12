# Test Calendar Permission - Quick Debug

## 🎯 Quick Test

Add this button temporarily to your Settings screen to test calendar permission directly:

### Location: `src/components/GlassSidebar.js`

Add after the calendar toggle:

```javascript
{/* DEBUG: Test Calendar Permission */}
{__DEV__ && (
  <TouchableOpacity
    style={[styles.menuItem, { backgroundColor: '#ff6b6b', marginTop: 10 }]}
    onPress={async () => {
      console.log('=== CALENDAR PERMISSION DEBUG START ===');
      
      try {
        // Step 1: Check current permission
        const check1 = await Calendar.getCalendarPermissionsAsync();
        console.log('1. Current permission:', JSON.stringify(check1, null, 2));
        
        // Step 2: Request permission
        const request = await Calendar.requestCalendarPermissionsAsync();
        console.log('2. After request:', JSON.stringify(request, null, 2));
        
        // Step 3: Verify permission
        const check2 = await Calendar.getCalendarPermissionsAsync();
        console.log('3. Verification:', JSON.stringify(check2, null, 2));
        
        // Step 4: Try to fetch calendars
        if (check2.status === 'granted') {
          const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
          console.log('4. Found calendars:', calendars.length);
          calendars.forEach(cal => {
            console.log('   -', cal.title, `(ID: ${cal.id})`);
          });
          
          // Step 5: Try to fetch events
          if (calendars.length > 0) {
            const calIds = calendars.map(c => c.id);
            const start = new Date();
            const end = new Date();
            end.setDate(end.getDate() + 7);
            
            const events = await Calendar.getEventsAsync(calIds, start, end);
            console.log('5. Found events:', events?.length || 0);
            if (events && events.length > 0) {
              events.forEach(evt => {
                console.log('   -', evt.title);
              });
            }
          }
          
          Alert.alert(
            'Calendar Test SUCCESS ✅',
            `Permission: ${check2.status}\n` +
            `Calendars: ${calendars.length}\n` +
            `Events: ${events?.length || 0}`
          );
        } else {
          Alert.alert(
            'Calendar Test FAILED ❌',
            `Permission Status: ${check2.status}\n` +
            `Can Ask Again: ${check2.canAskAgain}\n` +
            `Granted: ${check2.granted}`
          );
        }
      } catch (error) {
        console.error('ERROR:', error);
        Alert.alert('Error', error.message);
      }
      
      console.log('=== CALENDAR PERMISSION DEBUG END ===');
    }}
  >
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Calendar color="#FFF" size={20} />
      <Text style={[styles.menuText, { color: '#FFF', marginLeft: 10 }]}>
        🐛 Debug Calendar Permission
      </Text>
    </View>
  </TouchableOpacity>
)}
```

Don't forget to import Calendar at the top:
```javascript
import * as Calendar from 'expo-calendar';
```

---

## 📊 Expected Output

### If Working:
```
=== CALENDAR PERMISSION DEBUG START ===
1. Current permission: {
  "status": "granted",
  "granted": true,
  "canAskAgain": true
}
2. After request: {
  "status": "granted",
  "granted": true,
  "canAskAgain": true
}
3. Verification: {
  "status": "granted",
  "granted": true,
  "canAskAgain": true
}
4. Found calendars: 2
   - My Calendar (ID: 1)
   - Work Calendar (ID: 2)
5. Found events: 3
   - Team Meeting
   - Lunch
   - Project Review
=== CALENDAR PERMISSION DEBUG END ===

Alert: "Calendar Test SUCCESS ✅
Permission: granted
Calendars: 2
Events: 3"
```

### If Permission Denied:
```
=== CALENDAR PERMISSION DEBUG START ===
1. Current permission: {
  "status": "denied",
  "granted": false,
  "canAskAgain": false
}
2. After request: {
  "status": "denied",
  "granted": false,
  "canAskAgain": false
}
3. Verification: {
  "status": "denied",
  "granted": false,
  "canAskAgain": false
}
=== CALENDAR PERMISSION DEBUG END ===

Alert: "Calendar Test FAILED ❌
Permission Status: denied
Can Ask Again: false
Granted: false"
```

### If App Needs Rebuild:
```
=== CALENDAR PERMISSION DEBUG START ===
ERROR: [Error: Calendar API is not available]
=== CALENDAR PERMISSION DEBUG END ===

Alert: "Error
Calendar API is not available"
```
↑ This means you need to rebuild the app!

---

## 🔧 What To Do Based on Results

### Result 1: "Calendar API is not available"
**Problem**: expo-calendar not properly linked
**Solution**:
```bash
npx expo prebuild --clean
npx expo run:android
```

---

### Result 2: "status": "denied"
**Problem**: Permission actually denied
**Solution**:
```bash
# Option A: Grant in device settings
Settings → Apps → LifePilot → Permissions → Calendar → Allow

# Option B: Uninstall and fresh install
adb uninstall com.anupam.lp
npx expo run:android
# Then grant permission when asked
```

---

### Result 3: "status": "granted" but "canAskAgain": false
**Problem**: User previously denied permanently
**Solution**:
```bash
# Must manually enable in settings
Settings → Apps → LifePilot → Permissions → Calendar → Allow
```

---

### Result 4: SUCCESS but AI still shows error
**Problem**: Cache or state issue
**Solution**:
```javascript
// In Settings, after toggling calendar:
// Force refresh the calendar state
setTimeout(async () => {
  const freshCheck = await isCalendarConnected();
  setIsCalendarLinked(freshCheck);
}, 1000);
```

---

## 🎬 Step-by-Step Testing

1. **Add the debug button** (code above)
2. **Restart the app**
3. **Open Settings sidebar**
4. **Tap "🐛 Debug Calendar Permission" button**
5. **Watch the console output**
6. **Read the alert message**
7. **Follow the solution for your result**

---

## 📱 Testing on Real Device

```bash
# 1. Make sure device is connected
adb devices

# 2. Make your code changes (add debug button)

# 3. Run on device
npx expo run:android

# 4. Open React Native debugger
# Chrome: chrome://inspect
# Or use: npx react-devtools

# 5. In app, tap debug button

# 6. Watch console for detailed logs
```

---

## 🎯 Quick Commands

```bash
# Rebuild app
npx expo run:android

# Clean rebuild
npx expo prebuild --clean && npx expo run:android

# Check what's installed
adb shell pm list packages | grep lp

# Uninstall
adb uninstall com.anupam.lp

# Install fresh
npx expo run:android

# Check logs
adb logcat | grep Calendar
```

---

## ✅ Success Criteria

You know it's working when:
1. ✅ Debug button shows "SUCCESS"
2. ✅ Console shows `status: 'granted'`
3. ✅ Calendars found > 0
4. ✅ Events can be fetched (even if 0)
5. ✅ No error messages
6. ✅ AI chat doesn't show permission error

---

## 🎉 After It Works

Remove the debug button or wrap in `__DEV__` check:
```javascript
{__DEV__ && (
  // ... debug button code ...
)}
```

This way it only shows in development builds, not production!

---

**TL;DR: Add debug button → Tap it → Read logs → Follow solution** 🔍
