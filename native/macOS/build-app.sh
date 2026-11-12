#!/bin/bash
# Builds an UNSIGNED universal 옳은VOCA.app from native/macOS. No signing material is used or needed here.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-build}"; rm -rf "$OUT"; mkdir -p "$OUT/iconset"
SOURCES=(OrunVocaMacApp.swift MacNotebookView.swift MacNotebookStore.swift MacWebStudyView.swift)
for ARCH in arm64 x86_64; do
  xcrun --sdk macosx swiftc -O -parse-as-library -target "$ARCH-apple-macos14.0" "${SOURCES[@]}" -o "$OUT/OrunVoca-$ARCH"
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
plutil -lint "$APP/Contents/Info.plist"; lipo -info "$APP/Contents/MacOS/OrunVoca"
echo "Built unsigned $APP"
