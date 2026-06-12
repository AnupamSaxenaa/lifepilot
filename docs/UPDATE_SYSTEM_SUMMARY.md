# LifePilot Update System - Complete Guide

## 🎯 Overview

LifePilot now has a **complete two-tier update system**:

1. **OTA Updates** (Over-The-Air) - For JavaScript/React changes
2. **Force Updates** - For native code changes (requires new APK)

---

## 📦 Update System Components

### **1. OTA Updates (JavaScript Only)**

**What it does:**
- Checks for JS/React code updates from Expo
- Downloads in background
- Shows progress bar at bottom
- Auto-reloads app when ready

**Files:**
- `src/utils/updateManager.js` - OTA update logic
- `src/components/UpdateProgress.js` - Progress UI (bottom bar)
- `App.js` - Auto-check on app launch
- `SettingsScreen.js` - Manual "Check for Updates" button

**Usage:**
```bash
# Make code changes, then publish:
eas update --branch preview --message "Bug fixes"
```

---

### **2. Force Updates (APK Required)**

**What it does:**
- Checks Supabase for minimum required version
- **Blocks entire app** if update needed
- Shows full-screen overlay with:
  - Current & latest version
  - Release notes
  - Download button
- Downloads APK with real-time progress
- Opens Android install prompt
- Disappears after update installed

**Files:**
- `src/utils/versionChecker.js` - Version comparison logic
- `src/utils/apkDownloader.js` - APK download & install
- `src/components/ForceUpdateBlocker.js` - Full-screen blocker UI
- `App.js` - Version check on app launch

**Database Setup:**
See `docs/SETUP_FORCE_UPDATE.md` for full instructions

---

## 🚀 How Updates Work

### User Opens App:

```
1. App starts loading
   ↓
2. Check Supabase for min version requirement
   ↓
3a. Version OK? → Load app normally
   ↓
   Check for OTA updates (background)
   ↓
   If available: Download & show progress
   ↓
   Apply & reload

3b. Version TOO OLD? → Show force update blocker
   ↓
   User clicks "Download Update"
   ↓
   Download APK (show progress)
   ↓
   Open install prompt
   ↓
   User installs
   ↓
   App restarts with new version
```

---

## 🎨 UI Components

### **UpdateProgress** (Bottom Bar)
- Slides up from bottom during OTA updates
- Purple glow effect
- Spinning icons
- Progress bar with percentage
- Auto-hides when complete

### **ForceUpdateBlocker** (Full Screen)
- Pulsing red alert icon
- Version comparison
- Release notes box
- Large download button
- Real-time progress bar
- Install instructions

---

## 📝 When to Use Each Update Type

### Use **OTA Updates** for:
✅ UI changes
✅ Bug fixes in JavaScript
✅ New features (React components)
✅ Style/design tweaks
✅ Logic updates
✅ Content changes

### Use **Force Updates** for:
✅ Native module changes
✅ New permissions required
✅ Expo SDK upgrades
✅ Critical security fixes
✅ Database schema changes
✅ Breaking API changes

---

## 🔧 Developer Workflow

### Scenario 1: Fix UI Bug (OTA Update)

```bash
# 1. Fix the bug in code
# 2. Test locally
# 3. Publish update
eas update --branch preview --message "Fixed button alignment"

# Users get it automatically on next app open!
```

### Scenario 2: Add New Native Module (Force Update)

```bash
# 1. Update version in app.json
{
  "version": "1.1.0",  // was 1.0.0
  "android": {
    "versionCode": 2  // was 1
  }
}

# 2. Build new APK
eas build --profile preview --platform android

# 3. Upload APK to Supabase Storage (or other host)

# 4. Update Supabase database
UPDATE app_versions 
SET 
  min_version = '1.1.0',
  latest_version = '1.1.0',
  download_url = 'https://your-url/lifepilot-v1.1.0.apk',
  release_notes = 'Added calendar sync feature',
  force_update = true
WHERE platform = 'android';

# Users get blocked and must download new APK!
```

---

## 🧪 Testing

### Test OTA Updates:
1. Publish an update: `eas update --branch preview --message "test"`
2. Open app
3. Should see progress bar at bottom
4. App reloads with changes

### Test Force Updates:
1. Run SQL to require higher version:
```sql
UPDATE app_versions SET min_version = '99.0.0', force_update = true WHERE platform = 'android';
```
2. Open app
3. Should see full-screen blocker
4. Test download flow
5. Reset: `UPDATE app_versions SET min_version = '1.0.0', force_update = false WHERE platform = 'android';`

---

## 📊 Version Comparison Logic

```javascript
// App checks:
if (currentVersion < minVersion || forceUpdate === true) {
  // BLOCK APP - Show ForceUpdateBlocker
} else {
  // App works normally
  // Check for OTA updates in background
}
```

**Examples:**
- Current: 1.0.0, Min: 1.0.0, Force: false → ✅ App works
- Current: 1.0.0, Min: 1.1.0, Force: false → ❌ Blocked
- Current: 1.5.0, Min: 1.0.0, Force: true → ❌ Blocked (force flag)
- Current: 1.1.0, Min: 1.1.0, Force: false → ✅ App works

---

## 🎯 Key Features

### OTA Updates:
✅ Automatic check on launch
✅ Manual check in Settings
✅ Beautiful progress UI
✅ Non-blocking (downloads in background)
✅ Auto-reloads when ready

### Force Updates:
✅ Full app block (can't bypass)
✅ Version comparison
✅ Release notes display
✅ Real-time download progress
✅ Auto-trigger install prompt
✅ Handles errors gracefully
✅ Beautiful UI with animations

---

## 📚 Files Reference

```
src/
├── utils/
│   ├── updateManager.js          # OTA update logic
│   ├── versionChecker.js          # Version comparison
│   └── apkDownloader.js           # APK download/install
├── components/
│   ├── UpdateProgress.js          # OTA progress UI
│   └── ForceUpdateBlocker.js      # Force update blocker UI
└── screens/
    └── SettingsScreen.js          # Manual update check

docs/
├── SETUP_FORCE_UPDATE.md          # Database setup guide
└── UPDATE_SYSTEM_SUMMARY.md       # This file

scripts/
└── manage-versions.sql            # SQL helper scripts

App.js                              # Update system integration
```

---

## 🚨 Important Notes

1. **Always test before forcing updates** - You could block all users!
2. **Keep old APKs available** - In case rollback needed
3. **Use descriptive release notes** - Users need to know what changed
4. **Monitor download URLs** - Broken links = blocked users
5. **OTA updates are free** - Force updates cost bandwidth
6. **Version numbers must follow semver** - `major.minor.patch`

---

## 🆘 Troubleshooting

### OTA update not showing?
- Check Expo dashboard for published updates
- Verify branch name matches (preview/production)
- Clear app cache and restart

### Force update blocker not appearing?
- Check Supabase table exists
- Verify RLS policies allow public read
- Check version numbers are correctly formatted
- Look at console logs for errors

### APK download fails?
- Verify download_url is publicly accessible
- Test URL in browser
- Check file size (Android has limits)
- Verify correct MIME type

### Install prompt doesn't open?
- Enable "Unknown Sources" in Android settings
- Check file permissions
- Verify APK isn't corrupted
- Try downloading on different network

---

## ✨ Summary

You now have a **production-ready update system** that:
- ✅ Handles JavaScript updates seamlessly (OTA)
- ✅ Forces critical updates when needed (APK)
- ✅ Shows beautiful progress UI
- ✅ Blocks app when update required
- ✅ Downloads & installs automatically
- ✅ Works offline-friendly
- ✅ Handles errors gracefully

**Next steps:**
1. Set up Supabase table (see SETUP_FORCE_UPDATE.md)
2. Test OTA updates
3. Test force update flow
4. Build and distribute your first APK!
