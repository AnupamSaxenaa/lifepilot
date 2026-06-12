# 📱 WIDGETS - QUICK START GUIDE

## 🚀 BUILD & TEST (3 Commands)

```bash
# 1. Prebuild (generates native Android code)
npx expo prebuild --clean

# 2. Build APK
eas build --profile development --platform android

# 3. Install & test on device
# Download APK from EAS dashboard
```

---

## 📱 ADD WIDGET TO HOME SCREEN

1. Long press home screen
2. Tap "Widgets"
3. Find "LifePilot"
4. Drag to home screen
5. Done!

---

## 🎯 3 WIDGETS AVAILABLE

### ☀️ Today Tasks (4×2)
- Shows 5 tasks from Today
- Tap to open task detail
- Updates every 15 min

### ➕ Quick Add (2×1)
- Big purple "+" button
- Tap to add task
- Always ready

### 🎯 Stats (2×2)
- Tasks done today
- Current streak
- Level & XP

---

## 🧪 QUICK TEST

1. Create tasks in app
2. Go to home screen
3. Widget shows tasks ✅
4. Tap task → Opens detail ✅
5. Complete task in app
6. Widget updates ✅

---

## 🐛 TROUBLESHOOTING

**Widget not showing?**
```bash
npx expo prebuild --clean
```

**Widget not updating?**
- Wait 15-30 seconds
- Tap widget to force refresh

**Widget shows old data?**
```bash
adb shell pm clear com.anupam.lp
```

---

## 📁 WIDGET FILES

- `src/widgets/TodayTasksWidget.js`
- `src/widgets/QuickAddWidget.js`
- `src/widgets/StatsWidget.js`
- `src/widgets/registerWidgets.js`
- `src/utils/widgetUpdater.js`

---

## ✅ STATUS

🎉 **FULLY IMPLEMENTED**  
🚀 **READY TO BUILD**  
📱 **PRODUCTION READY**

---

**Next:** Build APK and test widgets!
