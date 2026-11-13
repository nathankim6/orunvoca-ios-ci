#!/bin/bash
# Builds an UNSIGNED universal 옳은VOCA.app from native/macOS. No signing material is used or needed here.
# Default: production flavor (no test hooks). QA_SMOKE=1 builds a separate TEST-ONLY flavor
# with the -D QA_SMOKE pronunciation fixture; it must never be distributed as an installer.
set -euo pipefail
cd "$(dirname "$0")"
QA_SMOKE="${QA_SMOKE:-0}"; QA_MARKER="orun-qa-smoke"
if [ "$QA_SMOKE" = "1" ]; then FLAVOR=QA_SMOKE; SWIFT_FLAGS=(-D QA_SMOKE); OUT="${1:-build-qa}"
  # Never overwrite or masquerade as the production output directory.
  case "$(basename "$OUT")" in build) echo "QA_SMOKE build must not use the production output dir: $OUT" >&2; exit 2;; esac
elif [ "$QA_SMOKE" = "0" ]; then FLAVOR=production; SWIFT_FLAGS=(); OUT="${1:-build}"
else echo "QA_SMOKE must be 0 or 1" >&2; exit 2; fi
rm -rf "$OUT"; mkdir -p "$OUT/iconset"
SOURCES=(OrunVocaMacApp.swift MacWebStudyView.swift)
for ARCH in arm64 x86_64; do
  xcrun --sdk macosx swiftc -O -parse-as-library ${SWIFT_FLAGS[@]+"${SWIFT_FLAGS[@]}"} -target "$ARCH-apple-macos14.0" "${SOURCES[@]}" -o "$OUT/OrunVoca-$ARCH"
done
lipo -create "$OUT/OrunVoca-arm64" "$OUT/OrunVoca-x86_64" -output "$OUT/OrunVoca"
# Model checks: same store source, executed natively.
node -e "const fs=require('fs');fs.writeFileSync('$OUT/RunChecks.swift',fs.readFileSync('MacNotebookStore.swift','utf8')+'\n'+fs.readFileSync('Tests/MacNotebookChecks.swift','utf8')+'\ntry MainActor.assumeIsolated { try MacNotebookChecks.main() }\n')"
mkdir -p "$OUT/checks-data"
if [ "${SKIP_MODEL_CHECKS:-0}" != "1" ]; then
  xcrun --sdk macosx swiftc -Onone "$OUT/RunChecks.swift" -o "$OUT/run-checks"
  "$OUT/run-checks" "$PWD/$OUT/checks-data" | tee "$OUT/model-checks.log"
  grep -q '^PASS' "$OUT/model-checks.log"
fi
# Icon: assemble the .icns directly from PNG renditions.
for S in 16 32 128 256 512; do sips -z $S $S AppIcon-1024.png --out "$OUT/iconset/$S.png" >/dev/null; D=$((S*2)); sips -z $D $D AppIcon-1024.png --out "$OUT/iconset/$S@2x.png" >/dev/null; done
node -e "const fs=require('fs');const m=[['icp4','16.png'],['icp5','32.png'],['ic11','16@2x.png'],['ic12','32@2x.png'],['ic07','128.png'],['ic13','128@2x.png'],['ic08','256.png'],['ic14','256@2x.png'],['ic09','512.png'],['ic10','512@2x.png']];const parts=m.map(([t,f])=>{const d=fs.readFileSync('$OUT/iconset/'+f);const h=Buffer.alloc(8);h.write(t,0,'ascii');h.writeUInt32BE(d.length+8,4);return Buffer.concat([h,d]);});const b=Buffer.concat(parts);const h=Buffer.alloc(8);h.write('icns',0,'ascii');h.writeUInt32BE(b.length+8,4);fs.writeFileSync('$OUT/AppIcon.icns',Buffer.concat([h,b]));"
APP="$OUT/옳은VOCA.app"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$OUT/OrunVoca" "$APP/Contents/MacOS/OrunVoca"; cp "$OUT/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"; cp Info.plist "$APP/Contents/Info.plist"; printf 'APPL????' > "$APP/Contents/PkgInfo"
if [ "$FLAVOR" = "QA_SMOKE" ]; then plutil -insert OrunBuildFlavor -string QA_SMOKE "$APP/Contents/Info.plist"; fi
plutil -lint "$APP/Contents/Info.plist"; lipo -info "$APP/Contents/MacOS/OrunVoca"
# Flavor gate on the final Mach-O: production must not contain the test fixture; QA must.
if grep -a -q "$QA_MARKER" "$APP/Contents/MacOS/OrunVoca"; then HAS_QA=yes; else HAS_QA=no; fi
if [ "$FLAVOR" = "production" ] && [ "$HAS_QA" = yes ]; then echo "FAIL: production binary contains QA_SMOKE fixture" >&2; exit 1; fi
if [ "$FLAVOR" = "QA_SMOKE" ] && [ "$HAS_QA" = no ]; then echo "FAIL: QA_SMOKE binary is missing the test fixture" >&2; exit 1; fi
{ echo "flavor=$FLAVOR"; echo "qa_fixture_present=$HAS_QA"; echo "signing=unsigned (linker ad-hoc only, no identity)"
  openssl dgst -sha256 -r "$APP/Contents/MacOS/OrunVoca" | sed 's/^/binary_sha256=/'
  openssl dgst -sha256 -r "$APP/Contents/Info.plist" | sed 's/^/info_plist_sha256=/'
} | tee "$OUT/build-flavor.txt"
codesign -dv "$APP/Contents/MacOS/OrunVoca" > "$OUT/codesign-info.txt" 2>&1 || true
echo "Built unsigned $FLAVOR $APP"
