# LifePilot Update System Architecture

## ⚠️ CRITICAL: READ THIS BEFORE MAKING CHANGES

This document explains the complete update system architecture for AI agents and developers working on LifePilot.

---

## 📋 Table of Contents
1. [Overview](#overview)
2. [Two-Tier Update System](#two-tier-update-system)
3. [File Structure](#file-structure)
4. [Update Flow](#update-flow)
5. [Database Schema](#database-schema)
6. [Rules for Agents](#rules-for-agents)
7. [Common Scenarios](#common-scenarios)

---

## Overview

LifePilot uses a **two-tier update system**:
1. **OTA (Over-The-Air) Updates** - For JavaScript/React code changes
2. **Force APK Updates** - For native code changes requiring new APK

**Key Principle**: OTA updates are seamless and automatic. Force updates block the entire app until user installs new APK.

---

## Two-Tier Update System

### 1. OTA Updates (JavaScript Only)

**What can be updated:**
- ✅ React components
- ✅ JavaScript logic
- ✅ UI/UX changes
- ✅ Styles (NativeWind/Tailwind)
- ✅ Bug fixes in JS code
- ✅ Assets (images, fonts)
- ✅ Business logic
- ✅ API calls and data handling

**What CANNOT be updated:**
- ❌ Native modules
- ❌ Expo SDK version
- ❌ app.json configuration
- ❌ Android/iOS permissions
- ❌ Native dependencies
- ❌ Build settings

**How it works:**
1. App checks Expo servers on launch
2. Downloads JS bundle in background
3. Shows progress bar at bottom of screen
4. Auto-reloads app when ready
5. No user action required (except app restart)

**Publishing OTA updates:**
```bash
# For preview builds
eas update --branch preview --message "Bug fixes"

# For production builds  
eas update --branch production --message "New features"
```

---

### 2. Force APK Updates (Native Changes)

**When to use:**
- ✅ Adding new native modules
- ✅ Upgrading Expo SDK
- ✅ Changing app permissions
- ✅ Modifying app.json settings
- ✅ Critical security patches
- ✅ Database schema changes
- ✅ Breaking API changes

**How it works:**
1. App checks Supabase `app_versions` table on launch
2. Compares current version with `min_version` from database
3. If `current_version < min_version` OR `force_update = true`:
   - Shows **full-screen blocker** overlay
   - User CANNOT use app
   - User must download and install new APK
4. After install, blocker disappears

**Process:**
1. Update version in `app.json`
2. Build new APK: `eas build --profile preview --platform android`
3. Upload APK to hosting (Supabase Storage, GitHub, etc.)
4. Update Supabase database with new version info
5. Users automatically blocked until they update

---

## File Structure

### Core Update Files (DO NOT DELETE)

```
src/
├── utils/
│   ├── updateManager.js           # OTA update logic
│   │   - checkForUpdates()
│   │   - downloadAndApply()
│   │   - checkAndUpdate()
│   │
│   ├── versionChecker.js          # Version comparison for force updates
│   │   - getCurrentVersion()
│   │   - checkForceUpdate()
│   │   - compareVersions()
│   │
│   └── apkDownloader.js           # APK download & install
│       - downloadAPK()
│       - installAPK()
│       - downloadAndInstallAPK()
│
├── components/
│   ├── UpdateProgress.js          # OTA progress UI (bottom bar)
│   │   - Shows during OTA download
│   │   - Progress bar with percentage
│   │   - Slides up from bottom
│   │
│   └── ForceUpdateBlocker.js      # Force update blocker (full screen)
│       - Blocks entire app
│       - Shows version info
│       - Download button
│       - Real-time progress
│       - Cannot be dismissed
│
└── screens/
    └── SettingsScreen.js          # Manual "Check for Updates" button
        - handleCheckForUpdates()

App.js                              # Update system integration
├── Checks force update on launch
├── Checks OTA updates (if no force update)
├── Renders UpdateProgress
└── Renders ForceUpdateBlocker
```

---

## Update Flow

### App Launch Flow

```
User opens app
    ↓
[App.js useEffect]
    ↓
1. Check Supabase for force update
   - Query: SELECT * FROM app_versions WHERE platform = 'android'
   - Compare current version with min_version
    ↓
2a. Force update required?
    YES → Show ForceUpdateBlocker (full screen)
          User must download APK
          App is BLOCKED
    ↓
2b. No force update required?
    YES → Load app normally
          ↓
          Check for OTA updates (background)
          ↓
          OTA available? → Download & show UpdateProgress
          ↓
          Apply & reload app
```

### Force Update User Flow

```
Force update detected
    ↓
ForceUpdateBlocker appears (full screen)
    ↓
Displays:
- ⚠️ Alert icon (pulsing)
- "Update Required"
- Current version: v1.0.0
- Latest version: v1.2.0
- Release notes
- [Download Update] button
    ↓
User clicks "Download Update"
    ↓
apkDownloader.downloadAPK() starts
    ↓
Progress bar shows: "Downloading... 23%"
    ↓
Download completes (100%)
    ↓
apkDownloader.installAPK() triggers
    ↓
Android install prompt opens
    ↓
User installs APK
    ↓
App restarts with new version
    ↓
versionChecker.checkForceUpdate() → No update needed
    ↓
ForceUpdateBlocker disappears
    ↓
App works normally ✅
```

---

## Database Schema

### Supabase Table: `app_versions`

```sql
CREATE TABLE app_versions (
  id serial PRIMARY KEY,
  platform text NOT NULL,           -- 'android' or 'ios'
  min_version text NOT NULL,        -- Minimum version required (e.g., '1.0.0')
  latest_version text NOT NULL,     -- Latest available version (e.g., '1.2.0')
  download_url text,                -- APK download URL
  release_notes text,               -- What's new in this version
  force_update boolean DEFAULT false, -- Force all users to update
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### Version Check Logic

```javascript
// In versionChecker.js
if (current_version < min_version) {
  // FORCE UPDATE REQUIRED
  return { updateRequired: true };
}

if (force_update === true) {
  // FORCE UPDATE REQUIRED (regardless of version)
  return { updateRequired: true };
}

// No force update needed
return { updateRequired: false };
```

### Example Data

```sql
-- Normal state (no force update)
| platform | min_version | latest_version | force_update | download_url |
|----------|-------------|----------------|--------------|--------------|
| android  | 1.0.0       | 1.0.0          | false        | null         |

-- Force update required (version too low)
| platform | min_version | latest_version | force_update | download_url |
|----------|-------------|----------------|--------------|--------------|
| android  | 1.2.0       | 1.2.0          | false        | https://... |

-- Force update required (force flag)
| platform | min_version | latest_version | force_update | download_url |
|----------|-------------|----------------|--------------|--------------|
| android  | 1.0.0       | 1.2.0          | true         | https://... |
```

---

## Rules for Agents

### ✅ DO:

1. **When making UI/logic changes:**
   - Edit code freely
   - These can be delivered via OTA
   - Tell user to publish: `eas update --branch preview --message "your changes"`

2. **When adding NPM packages (JS only):**
   - Add to package.json
   - Install locally
   - Can be delivered via OTA

3. **When modifying screens/components:**
   - Edit freely
   - OTA update will handle it

4. **When user asks about updates:**
   - Direct them to Settings → "Check for Updates" button
   - Or explain OTA vs Force update difference

### ❌ DON'T:

1. **Never delete update system files:**
   - `src/utils/updateManager.js`
   - `src/utils/versionChecker.js`
   - `src/utils/apkDownloader.js`
   - `src/components/UpdateProgress.js`
   - `src/components/ForceUpdateBlocker.js`

2. **Never remove update logic from App.js:**
   - `checkForceUpdate()` call
   - `UpdateManager.checkAndUpdate()` call
   - `<UpdateProgress>` component
   - `<ForceUpdateBlocker>` component

3. **When adding native modules:**
   - ⚠️ WARN USER: "This requires a new APK build"
   - Explain: OTA won't work for this
   - User must:
     1. Update version in app.json
     2. Build new APK
     3. Update Supabase database
     4. Users will be forced to update

4. **When modifying app.json:**
   - ⚠️ WARN USER: "This requires force update"
   - Changes to permissions, config, etc. need new APK

5. **Never bypass the force update check:**
   - Don't add conditions to skip ForceUpdateBlocker
   - It's a critical security/compatibility feature

---

## Common Scenarios

### Scenario 1: User wants to fix a bug in TodayScreen

```
✅ This is JavaScript code
✅ Can be delivered via OTA
✅ No APK rebuild needed

Steps:
1. Fix the bug
2. Tell user: "Publish this with: eas update --branch preview --message 'Fixed bug'"
3. Users get update on next app open
```

### Scenario 2: User wants to add react-native-camera

```
❌ This is a native module
❌ Cannot be delivered via OTA
❌ Requires new APK

Response:
"⚠️ Adding react-native-camera requires a new APK build because it's a native module.

Steps needed:
1. Update version in app.json (e.g., 1.0.0 → 1.1.0)
2. Build new APK: eas build --profile preview --platform android
3. Upload APK to hosting
4. Update Supabase:
   UPDATE app_versions 
   SET min_version = '1.1.0', 
       latest_version = '1.1.0',
       download_url = 'YOUR_APK_URL',
       force_update = true
   WHERE platform = 'android';
5. Users will be blocked until they install new APK"
```

### Scenario 3: User wants to change app icon

```
⚠️ App icon is in app.json
❌ Cannot be delivered via OTA
❌ Requires new APK

Response:
"Changing the app icon requires rebuilding the APK since it's configured in app.json.
Follow force update process."
```

### Scenario 4: User wants to add new screen

```
✅ New screens are JavaScript
✅ Can be delivered via OTA
✅ No APK rebuild needed

Steps:
1. Create the screen
2. Add to navigation
3. Publish OTA update
```

### Scenario 5: User reports "Update not working"

```
Troubleshooting:
1. Check if it's OTA or Force update issue
2. For OTA:
   - Verify update was published to correct branch
   - Check Expo dashboard
   - User should restart app
3. For Force update:
   - Check Supabase app_versions table exists
   - Verify download_url is accessible
   - Check RLS policies
   - Look at console logs
```

---

## Integration Points

### App.js

```javascript
// 1. Force update check (FIRST, blocks app if needed)
useEffect(() => {
  const { updateRequired, updateInfo } = await checkForceUpdate();
  if (updateRequired) {
    setForceUpdateRequired(true);
    setForceUpdateInfo(updateInfo);
  }
}, []);

// 2. OTA update check (SECOND, only if no force update)
useEffect(() => {
  if (!forceUpdateRequired) {
    await UpdateManager.checkAndUpdate(onProgress, onStatusChange);
  }
}, [forceUpdateRequired]);

// 3. Render blockers
return (
  <>
    <NavigationContainer>...</NavigationContainer>
    <UpdateProgress status={updateStatus} progress={updateProgress} />
    <ForceUpdateBlocker visible={forceUpdateRequired} updateInfo={updateInfo} />
  </>
);
```

---

## Version Number Format

**Always use semantic versioning:**
```
MAJOR.MINOR.PATCH
  │      │      │
  │      │      └─ Bug fixes (OTA ok)
  │      └──────── New features (OTA ok, unless native)
  └─────────────── Breaking changes (Force update)
```

**Examples:**
- `1.0.0` → `1.0.1` (Bug fix, OTA)
- `1.0.1` → `1.1.0` (New feature, OTA if JS-only)
- `1.1.0` → `2.0.0` (Breaking change, Force update)

---

## Testing

### Test OTA Updates:
```bash
# 1. Publish test update
eas update --branch preview --message "test"

# 2. Open app
# 3. Should see UpdateProgress at bottom
# 4. App reloads with changes
```

### Test Force Updates:
```sql
-- 1. Trigger force update
UPDATE app_versions SET min_version = '99.0.0', force_update = true WHERE platform = 'android';

-- 2. Open app
-- 3. Should see ForceUpdateBlocker (full screen)

-- 4. Reset
UPDATE app_versions SET min_version = '1.0.0', force_update = false WHERE platform = 'android';
```

---

## Error Handling

### Update system gracefully handles:
- ✅ Network failures
- ✅ Corrupted downloads
- ✅ Missing download URLs
- ✅ Supabase errors
- ✅ Invalid version formats

### On error:
- OTA: Silently fails, app continues working
- Force update: Shows error alert, retry button provided

---

## Performance

- **OTA check**: ~200ms (doesn't block app load)
- **Force update check**: ~300ms (checked before app loads)
- **APK download**: Depends on file size and network (10-50 MB typical)
- **Update apply**: Instant app reload

---

## Security

- ✅ Force update cannot be bypassed by user
- ✅ Download URLs must be HTTPS
- ✅ Version checks happen server-side (Supabase)
- ✅ APK signature verified by Android
- ✅ RLS policies protect version management

---

## Database Changes & Updates

### ⚠️ CRITICAL: Database Schema Changes

**When modifying Supabase database schema:**

1. **Requires Force Update** if:
   - Adding new required columns
   - Changing column types
   - Removing columns that old versions depend on
   - Adding/changing RLS policies that break old versions
   - Changing table structure

2. **Process:**
   ```sql
   -- 1. Make database changes in Supabase
   ALTER TABLE tasks ADD COLUMN new_field text;
   
   -- 2. Update app code to use new field
   -- 3. Increment version in app.json
   -- 4. Build new APK
   -- 5. Update app_versions table to force update
   ```

3. **Backward Compatibility:**
   - Always add new columns as NULLABLE first
   - Provide default values for new fields
   - Don't remove columns immediately - deprecate first
   - Test old app version with new database schema

### Database Migration Strategy

**Safe approach:**
```
Version 1.0.0 (live) → Add nullable column
    ↓
Version 1.1.0 (new) → Use new column + keep old working
    ↓
Force update users to 1.1.0
    ↓
Version 1.2.0 (future) → Remove old column (safe now)
```

**NEVER:**
- ❌ Change existing column types without force update
- ❌ Remove columns while old versions are in use
- ❌ Change RLS policies that break old app versions
- ❌ Make breaking API changes without version coordination

**Example Database Update Flow:**

```javascript
// If you modify tasks table:
// Old schema: { id, title, is_completed }
// New schema: { id, title, is_completed, priority }

// Step 1: Add column (backward compatible)
ALTER TABLE tasks ADD COLUMN priority integer DEFAULT 0;

// Step 2: Update dataManager.js to use new field
export const addTask = async (userId, currentTasks, taskData) => {
  const tempTask = {
    title: taskData.title,
    priority: taskData.priority || 0, // NEW FIELD
    // ...
  };
};

// Step 3: Force update required!
// Update app_versions:
UPDATE app_versions 
SET min_version = '1.1.0',
    latest_version = '1.1.0',
    release_notes = 'Added task priority feature',
    force_update = true
WHERE platform = 'android';
```

---

## Summary for Agents

**Quick Decision Tree:**

```
Is the change affecting...
│
├─ JavaScript/React code only?
│  └─ ✅ Use OTA update
│     └─ Tell user: eas update --branch preview --message "..."
│
├─ Supabase database schema?
│  ├─ Adding nullable column? → ✅ OTA ok (if app handles null)
│  ├─ Removing column? → ❌ Force update required
│  ├─ Changing column type? → ❌ Force update required
│  └─ Breaking RLS change? → ❌ Force update required
│
├─ Native modules/app.json/permissions?
│  └─ ❌ Requires Force update
│     └─ Warn user about APK rebuild process
│
└─ Not sure?
   └─ Ask: "Does this need native code or break old versions?"
      └─ If YES: Force update
      └─ If NO: OTA update
```

**Remember:**
- 🟢 OTA = Fast, seamless, automatic
- 🔴 Force = Blocks app, requires APK install
- 🗄️ Database changes usually need Force update
- ⚠️ Never remove update system files
- ⚠️ Always warn before native changes
- ⚠️ Always consider backward compatibility

---

## Questions?

If you're an AI agent and unsure whether a change needs OTA or Force update:
1. Check if it modifies native code or app.json → Force update
2. Check if it modifies database schema → Usually Force update
3. Check if it breaks compatibility with old versions → Force update
4. If no to all above → OTA update is fine

**When in doubt, ask the user.**
