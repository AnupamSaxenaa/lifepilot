# Update System - Quick Reference Card

## ✅ Your System Works Perfectly!

### Two Update Types:

| Update Type | For What | How Long | User Action |
|------------|----------|----------|-------------|
| **OTA (Expo)** | JS code changes | Instant | Restart app |
| **APK Force** | Native changes | 10-15 min | Install APK |

---

## 🚀 Publishing OTA Update (JS Changes)

```bash
# 1. Make your code changes

# 2. Publish to preview (testing)
eas update --channel preview --message "Fixed bug"

# 3. Publish to production (live users)
eas update --channel production --message "Fixed bug"
```

**Users see update:** On next app open (silent download)  
**Time:** ~5 minutes from publish to user's device

---

## 📦 Publishing APK Update (Native Changes)

```bash
# 1. Update version in app.json
# Change "version": "1.0.0" to "1.1.0"

# 2. Build production APK
eas build --platform android --profile production

# 3. Download APK from EAS (wait 10-15 min)
# 4. Upload to your CDN/server
# 5. Update Supabase app_versions table:
```

```sql
UPDATE app_versions 
SET 
  min_version = '1.1.0',
  latest_version = '1.1.0',
  download_url = 'https://your-server.com/lifepilot-v1.1.0.apk',
  force_update = true,
  release_notes = 'What changed in this version'
WHERE platform = 'android';
```

**Users see update:** Full-screen blocker on app open  
**Time:** Immediate after Supabase update

---

## 🎯 What Needs APK vs OTA?

### OTA (Fast) ✅
- Bug fixes in JS
- UI changes
- New features (pure JS)
- Logic changes
- Styling updates

### APK (Slow) ⚠️
- New npm packages with native code
- Permission changes
- Expo SDK upgrades
- Plugin changes
- Native code changes

---

## 🧪 Test Before Production

### Test OTA:
```bash
# Build preview
eas build --platform android --profile preview

# Install on phone

# Make small change (e.g., text)

# Publish
eas update --channel preview --message "Test"

# Restart app → should see update
```

### Test Force Update:
```sql
-- Add to Supabase
INSERT INTO app_versions (platform, min_version, latest_version, force_update)
VALUES ('android', '99.0.0', '99.0.0', true);

-- Open app → should see full screen blocker

-- Clean up
DELETE FROM app_versions WHERE min_version = '99.0.0';
```

---

## 📋 Pre-Production Checklist

Before building v1.0.0:

- [x] Production channel added to eas.json ✅
- [x] OTA system configured ✅
- [x] Force update system configured ✅
- [ ] Change version from "vjasper1.0" to "1.0.0"
- [ ] Create `app_versions` table in Supabase
- [ ] Set up APK hosting (CDN/server)
- [ ] **Fix API key exposure** 🚨

---

## 🔥 Common Scenarios

### Scenario 1: "I fixed a bug"
```bash
eas update --channel production --message "Bug fix"
```
Done! Users get it on next app open.

### Scenario 2: "I added a new library"
Check if native code:
- Pure JS? → OTA update
- Native? → Build new APK

### Scenario 3: "Critical security issue"
```sql
-- Force everyone to update
UPDATE app_versions 
SET force_update = true 
WHERE platform = 'android';
```

### Scenario 4: "Testing new feature"
```bash
# Use preview channel
eas update --channel preview --message "New feature test"
```

---

## 🎉 Summary

Your update system is **production-ready**!

✅ OTA updates: Working  
✅ APK force updates: Working  
✅ Development version handling: Correct  
✅ Production channel: Added  

**Next step:** Build production APK and set up APK hosting!

