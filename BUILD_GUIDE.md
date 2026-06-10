# 🤖 LifePilot (LP) Android Build Guide

If you are an AI assistant or developer building the Android release APK for this project on this machine, follow these instructions to avoid compilation errors.

---

## ⚠️ Common Pitfalls & Resolutions

1. **JDK 24+ Incompatibility (CMake/JNI errors)**:
   - **Problem**: The system's default JDK is Java 25. Java 25 restricts native method calls (JNI) by default and outputs warning logs to `stderr`. This breaks CMake/JNI checks for native packages like `react-native-worklets` and aborts the build.
   - **Solution**: Force the build to compile using the pre-installed Homebrew **OpenJDK 17**.

2. **React Native New Architecture**:
   - **Problem**: Compiling the New Architecture requires a heavy CMake / C++ compilation process that is prone to OS-level toolchain configuration differences.
   - **Solution**: Keep `newArchEnabled=false` in `android/gradle.properties` unless explicitly requested otherwise.

3. **Compiler OOM (Out of Memory)**:
   - **Problem**: Standard Gradle configurations limit heap space to 2GB, causing the C++ bundle to crash near 95% completion.
   - **Solution**: Keep the JVM memory arguments at 4GB in `android/gradle.properties`.

---

## 🛠️ Step-by-Step Build Commands

Always run these commands from the root directory of the project:

### 1. Prebuild / Generate Native Project
If you need to regenerate the native `android` folder (due to package updates or configuration changes in `app.json`), run:
```bash
npx expo prebuild -p android --clean
```

### 2. Set Java Home & Compile Release APK
To compile the production APK (`app-release.apk`), run this combined command. It forces Gradle to use the compatible OpenJDK 17 directory:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home && cd android && ./gradlew clean && ./gradlew assembleRelease
```

---

## 📂 Output APK Location
After a successful build, you can find the final APK at:
`android/app/build/outputs/apk/release/app-release.apk`
