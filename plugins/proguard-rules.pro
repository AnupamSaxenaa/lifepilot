# ============================================================================
# LifePilot — ProGuard / R8 rules
# ============================================================================
# Minification is ENABLED for release builds (see gradle.properties:
# android.enableMinifyInReleaseBuilds). Without it the app shipped ~62 MB of
# unminified dex across 7 classes*.dex files.
#
# The danger with R8 in React Native is that breakage appears ONLY in release
# builds, never in debug, and usually as a runtime crash rather than a build
# error. Anything reached by reflection, JNI, or a native module registry is
# invisible to R8's reachability analysis and will be stripped or renamed.
#
# Most libraries ship consumer rules inside their AAR, which are applied
# automatically. The rules below cover this project's reflection-heavy
# dependencies explicitly rather than trusting that.
#
# If a release build crashes where debug does not, suspect this file first, and
# check `android/app/build/outputs/mapping/release/` for what was removed.
# ============================================================================

# ─── React Native core ───────────────────────────────────────────────────────
# Native modules and view managers are instantiated by name from the JS bridge.
-keep,includedescriptorclasses class com.facebook.react.bridge.** { *; }
-keep,includedescriptorclasses class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.uimanager.** { *; }
-keep class com.facebook.jni.** { *; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactProp <methods>; }
-keepclassmembers class * { @com.facebook.react.bridge.ReactMethod <methods>; }
-keepclassmembers class * { @com.facebook.proguard.annotations.DoNotStrip *; }
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-dontwarn com.facebook.react.**

# ─── Hermes ──────────────────────────────────────────────────────────────────
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jsi.** { *; }

# ─── Expo modules ────────────────────────────────────────────────────────────
# expo-modules-core resolves modules and their Kotlin coroutine continuations
# reflectively, so stripped names break every Expo package at once.
-keep class expo.modules.** { *; }
-keep class expo.core.** { *; }
-keepclassmembers class * { @expo.modules.core.interfaces.ExpoMethod <methods>; }
-dontwarn expo.modules.**

# Kotlin metadata is required by expo-modules-core's reflection.
-keep class kotlin.Metadata { *; }
-keepclassmembers class **$WhenMappings { <fields>; }
-keep class kotlin.coroutines.Continuation

# ─── Reanimated / Worklets ───────────────────────────────────────────────────
# Worklets are compiled to strings and evaluated at runtime; renaming breaks them.
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.worklets.** { *; }
-keep class com.worklets.** { *; }

# ─── Notifee (alarms and scheduled notifications) ────────────────────────────
# Receivers and services are declared in the manifest and constructed by name.
-keep class io.invertase.notifee.** { *; }
-keep class app.notifee.** { *; }
-dontwarn app.notifee.**

# ─── Google Mobile Ads (rewarded ads) ────────────────────────────────────────
-keep class com.google.android.gms.ads.** { *; }
-keep class com.google.android.ump.** { *; }
-dontwarn com.google.android.gms.**

# ─── Other native views used by this app ─────────────────────────────────────
-keep class com.horcrux.svg.** { *; }
-keep class com.swmansion.rnscreens.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.reactnativecommunity.** { *; }

# ─── App-blocking accessibility service ──────────────────────────────────────
# Instantiated by the Android framework from the manifest entry, never from code,
# so R8 cannot see any reference to it.
-keep class com.anupam.** extends android.accessibilityservice.AccessibilityService { *; }
-keep class * extends android.accessibilityservice.AccessibilityService { *; }
-keep class * extends android.appwidget.AppWidgetProvider { *; }
-keep class * extends android.content.BroadcastReceiver { *; }
-keep class * extends android.app.Service { *; }

# ─── Networking (OkHttp/Okio via RN) ─────────────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# ─── Keep source line numbers for readable crash reports ─────────────────────
# Without this, Play Console stack traces are unusable. The mapping file is
# uploaded separately so symbols are not exposed in the APK.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Annotations drive much of the reflection above; losing them breaks it.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
