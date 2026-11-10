#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/ModuleCache
SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
SDKROOT="$SDK" xcrun swiftc -sdk "$SDK" -target arm64-apple-ios17.0-simulator \
  -module-cache-path build/ModuleCache -parse-as-library OrunVoca/*.swift \
  -o build/OrunVoca-simulator
xcrun vtool -show-build build/OrunVoca-simulator
plutil -lint OrunVoca/Info.plist OrunVoca/PrivacyInfo.xcprivacy OrunVoca.xcodeproj/project.pbxproj
node --input-type=module - <<'JS'
import fs from 'node:fs';
const source=fs.readFileSync('OrunVoca/NotebookStore.swift','utf8');
const checks=fs.readFileSync('Tests/NotebookChecks.swift','utf8').replace('@main struct NotebookChecks','struct NotebookChecks');
fs.writeFileSync('build/RunNotebookChecks.swift',source+'\n'+checks+'\ntry MainActor.assumeIsolated { try NotebookChecks.main() }\n');
JS
swift build/RunNotebookChecks.swift "$PWD/build"
