# 옳은보카 iOS release preparation

## Scope and architecture

- Native project: `native/ios/OrunVoca.xcodeproj`, shared scheme `OrunVoca`.
- SwiftUI + WKWebView, iOS 17+, iPhone and iPad. No npm/native bridge dependencies; web `package.json` remains untouched.
- Proposed bundle ID: `com.orunvoca.app`. **Not registered or confirmed available.** Version 1.0.0, build 1; no team is hardcoded.
- Online study loads **https://orunvoca.co.kr/**. HTTP 200 observed 2026-11-10. This preserves the deployed HTTPS origin for Supabase auth, CORS, ES modules, BrowserRouter, cookies, and localStorage. It does not prove authentication works inside WKWebView.
- Bundled `dist` / custom-scheme loading deliberately not shipped: custom origin/module/CORS/auth behavior would need device verification and could break the existing service. Deploy the redesigned web build to the official site before testing this app. No loopback HTTP server or ATS exception is needed.
- Real native functionality: independently usable offline vocabulary notebook with add/edit/delete/search, persistent local JSON, reveal-and-grade flashcards, 10-minute retries, doubling 1–64-day review intervals, system English pronunciation, UTF-8 TSV import/export, duplicate handling, and delete-all confirmation. It is not a fake screenshot or prefilled demo. It starts empty. It does **not** automatically sync or download account vocabulary.
- Native UI uses Dynamic Type, system labels/buttons, safe-area layout, iPad-compatible forms and sheets, and scrollable review content. These are implementation properties, not a claim of accessibility certification.
- WKWebView has persistent website data, back gestures, retry and process-crash recovery. Main-frame links outside the exact production HTTPS host open in Safari view; `mailto:` and `tel:` use system apps. No JavaScript-to-native bridge or arbitrary custom URL handler. Native notebook imports only validated UTF-8 TSV, 2 columns, <=10,000 rows, <5MB. Imported text is never executed.

## Build and verification

From repository root:

```sh
# Full unsigned simulator Xcode build (preferred)
xcodebuild -project native/ios/OrunVoca.xcodeproj \
  -scheme OrunVoca -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath native/ios/build CODE_SIGNING_ALLOWED=NO build

# Compiler + model regression fallback, no simulator service required
bash native/ios/scripts/verify-native.sh
```

The fallback compiles/links a real arm64 iOS Simulator Mach-O executable against the installed SDK, validates plists/project syntax, and runs isolated notebook model checks through the Swift interpreter. It is **not** a complete `.app`, asset-catalog compilation, simulator run, or UI/integration test. The `ValueState` alias preserves the stable SwiftUI property wrapper API instead of the Xcode 27 SDK's new `State` macro.

To regenerate the checked-in project after deliberate file-list changes: `node native/ios/scripts/create-project.mjs`. The app icon is an opaque 1024×1024 PNG rendered from the repository's original lighthouse mark. Regenerate with:

```sh
swift native/ios/scripts/create-icon.swift src/assets/brand/orun-mark.png \
  native/ios/OrunVoca/Assets.xcassets/AppIcon.appiconset/AppIcon.png
```

### Environment observations, 2026-11-10

- Xcode 27.1 / build 27A9275; installed iOS / simulator SDK 27.1.
- `security find-identity -v -p codesigning`: **0 valid identities**. No private keys were read; no certificates, profiles, identifiers, or App Store Connect record were created.
- Full `xcodebuild` and `simctl` are **[blocked]**: sandbox denies `/Library/Developer/PrivateFrameworks/CoreSimulator.framework`, and Xcode fails to load IDESimulatorFoundation before building. This is not a Swift source compile error. Run in an authorized Xcode environment with access to the system framework. Do not blindly run first-launch repairs or install anything as a substitute for permission.
- **PASS:** `bash native/ios/scripts/verify-native.sh` compiled and linked all native Swift sources into an arm64 **IOSSIMULATOR** executable (minimum iOS 17.0, SDK 27.1). Info.plist, privacy manifest, and project syntax validation passed. Native model regression checks passed: add/trim, due queue, review scheduling, duplicate import, atomic invalid import, persistence, export, delete. Full log: `native/ios/build/verification.log`. Runtime UI, live account auth, and asset-catalog compilation are not yet verified.

## Required device / simulator acceptance checks

1. Clean launch on iPhone and iPad, portrait/landscape, keyboard, large accessibility text, VoiceOver, dark mode, split view, and safe areas.
2. Actual student and teacher login using authorized test accounts, persistent login after force-quit, logout, session expiry, invalid-code errors, and existing web role protection. Never put production student credentials in review notes.
3. Study, TTS/audio unlock, practice/exam submission, teacher flows, background/foreground, and failed requests. Test offline launch: online tab must offer retry, native notebook must remain fully usable. Native study voices may require an initial system download; do not promise every voice is preinstalled.
4. Create/edit/review cards in airplane mode, relaunch persistence, known/forgotten intervals, TSV import (duplicates, malformed rows, big/invalid UTF-8 files), export through Files/share, deletion confirmation, storage failure, corrupt-file preservation. TSV exports contain words/meanings only, not scheduling history. iOS encrypted device backup may include app data.
5. External links open correctly; no unexpected OAuth redirects. If social login is introduced, evaluate Sign in with Apple and ASWebAuthenticationSession instead of assuming Safari view shares credentials.
6. Existing online PDF/XLSX/blob downloads, web share, clipboard, popups, microphone/camera features need explicit testing. The wrapper does not implement a generic WKDownload/blob export bridge. Fix required web export flows before release; native notebook TSV export already uses system Files UI.
7. Web error/empty states must not leave users staring at spinners. This shell can detect document-level navigation failure, not every web API request failure.

## App Store gates: not submitted, not approved

This is more than a remote-site-only wrapper because the offline notebook provides genuine native study utility, but **App Review 4.2 minimum-functionality risk is not eliminated or preapproved**. Review must assess a polished, coherent product, not merely the presence of one native tab. Explain the real offline features, demonstrate them in review notes, and do not claim synchronization that does not exist.

Before any upload:

- Owner confirms paid Apple Developer Program membership and handles any paid actions or agreements. Do not accept terms on their behalf.
- Owner/developer selects the correct signing team, checks bundle-ID availability, registers it, and creates appropriate signing credentials/provisioning in the normal authorized flow. No signing certificate exists locally at the observed check.
- Register an App Store Connect app **only after explicit owner authorization**. Choose app name, primary language, SKU, age rating, distribution countries, and category deliberately.
- Publish a valid privacy-policy URL and support URL, available without login; link them clearly in the app/web settings. The native app currently explains local behavior but does not invent a policy URL. Ensure a real contact/support channel.
- Privacy manifest included declares no tracking and no direct required-reason API usage. This is about the native implementation, **not a blanket declaration that the online service collects no data**. Inventory Supabase/website data, student identifiers, login/access codes, usage, server logs, retention/deletion, processors, child/student consent and analytics before completing App Privacy labels. Update manifest if APIs or SDKs are added. Review encryption/export-compliance answers, rather than asserting an exemption without checking backend/network usage.
- If the service supports account creation, satisfy in-app account-deletion requirements, including server-side data deletion. Do not claim native notebook reset deletes a server account.
- Audit any sales/subscriptions/unlock links under Apple's current payment rules and the chosen storefront. No IAP was added; do not silently launch a web checkout inside the app.
- Capture actual required iPhone/iPad screenshots from the running release build, supply authorized reviewer test access and clear instructions, test TestFlight, and complete accessibility/content/rights checks. No synthetic screenshots should be presented as app-runtime proof.

Authorized release command, once signing and runtime gates are complete:

```sh
xcodebuild -project native/ios/OrunVoca.xcodeproj -scheme OrunVoca \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath native/ios/build/OrunVoca.xcarchive \
  DEVELOPMENT_TEAM=YOUR_TEAM_ID archive
```

Open the archive in Xcode Organizer and export/upload with the owner's selected team and authorized App Store Connect configuration. No signed IPA, archive upload, paid action, agreement acceptance, or App Store approval is claimed by this implementation.
