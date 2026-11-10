# OrunVoca iOS source CI

This public repository contains **only the native iOS app source and its build documentation/CI**. The existing web application and backend remain private and are not copied here.

## Unsigned simulator validation

Run **Actions → iOS unsigned simulator build → Run workflow** manually. The workflow runs native notebook model regression checks and builds the `OrunVoca` scheme with `macos-latest`, `xcodebuild`, a generic iOS Simulator destination, and code signing disabled. It uploads a ZIP containing `OrunVoca.app` and build/check logs.

The simulator app is **not** an iPhone-installable IPA, signed archive, TestFlight distribution, App Store submission, approval, or release. No Apple credentials, signing profiles, certificates, API keys, or private service code are stored here. No automatic push/pull-request build triggers are enabled.

The app includes a native offline vocabulary notebook and loads the public HTTPS online study site. Authentication, device UI, accessibility, downloads, privacy disclosures, signing, and App Review gates still require verification. See [iOS release preparation](docs/ios-release.md) for constraints, not a release claim.

## Local build

```sh
xcodebuild -project native/ios/OrunVoca.xcodeproj -scheme OrunVoca \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath native/ios/build CODE_SIGNING_ALLOWED=NO build
```
