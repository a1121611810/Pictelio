# Local Release Build Test Report

## Test Overview

- **Task**: Task 11 — 本地 release 构建测试 (Pictelio public release plan)
- **Branch**: `feature/pictelio-public-release`
- **Test Date/Time**: 2026-06-27 14:09 CST (2026-06-27T06:09Z)
- **Tester**: Automated local test run

## Objective

Verify that the release signing configuration added in Task 10 works end-to-end on a local machine by generating a temporary release keystore, running `pnpm run build:android:release`, and confirming the output APK is signed.

## Commands Run

### 1. Generate test release keystore

```bash
keytool -genkey -v \
  -keystore android/app/pictelio-release.keystore \
  -alias pictelio \
  -keyalg RSA -keysize 2048 \
  -validity 10000 \
  -storepass *** \
  -keypass *** \
  -dname "CN=Pictelio, OU=Pictelio, O=Pictelio, L=Pictelio, ST=Pictelio, C=US"
```

> **Note**: Both passwords were set to `***` in this report; the actual test password was a simple test-only value.

### 2. Run local release build

```bash
PICTELIO_KEYSTORE_PASSWORD=*** PICTELIO_KEY_PASSWORD=*** pnpm run build:android:release
```

This executed:

```
pnpm run sync:android-version
pnpm run build
pnpm run cap:sync
cd android && ./gradlew assembleRelease
```

### 3. Verify the APK

`apksigner` was located in the Android SDK build-tools (`.../build-tools/36.1.0/apksigner`).

```bash
$ANDROID_HOME/build-tools/36.1.0/apksigner verify --verbose android/app/build/outputs/apk/release/app-release.apk
```

## Build Output Summary

```
BUILD SUCCESSFUL in 15s
284 actionable tasks: 49 executed, 235 up-to-date
```

The Gradle release assemble completed without errors, including:

- `:app:validateSigningRelease`
- `:app:packageRelease`
- `:app:assembleRelease`

## APK Verification Output

```
Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Verified using v3.1 scheme (APK Signature Scheme v3.1): false
Verified using v4 scheme (APK Signature Scheme v4): false
Verified for SourceStamp: false
Number of signers: 1
```

The APK at `android/app/build/outputs/apk/release/app-release.apk` exists (~3.2 MB) and is signed using the v2 APK Signature Scheme with one signer.

## Notes

- **This keystore is for local testing only.** The keystore generated for this test (`android/app/pictelio-release.keystore`) uses a weak, publicly-known test password and must **not** be used for the real release.
- **The real release keystore must be generated separately and kept secret.** Store the production keystore and its passwords in a secure location (e.g., CI/CD secrets, password manager, or dedicated signing service). Never commit keystore files or passwords to version control.
- After this test, the test keystore and release build output were deleted from the working tree.

## Clean-up Status

- [x] Deleted `android/app/pictelio-release.keystore`
- [x] Deleted `android/app/build/outputs/apk/release/`
- [x] Verified no `.keystore`, `.jks`, or release APK files remain in the working tree
