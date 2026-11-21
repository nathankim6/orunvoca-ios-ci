#!/usr/bin/env bash
# Emulator runtime smoke for the native shell. Public pages only: never types credentials,
# never completes a sign-in, never submits, creates, saves or deletes website data.
set -uo pipefail
OUT=runtime-smoke/android
mkdir -p "$OUT"
PKG=com.orunvoca.app
APK=native/android/app/build/outputs/apk/debug/app-debug.apk
fail=0
note() { echo "$*" | tee -a "$OUT/summary.txt"; }
check() { if eval "$2"; then note "PASS $1"; else note "FAIL $1"; fail=1; fi; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
resumed() { adb shell dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity' | head -1 | tr -d '\r'; }
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb exec-out cat /sdcard/ui.xml > "$OUT/$1.xml" 2>/dev/null; }
center() { # $1 xml, $2 exact text or content-desc -> "x y"
  python3 - "$1" "$2" <<'PY'
import re, sys, xml.etree.ElementTree as ET
try: root = ET.parse(sys.argv[1]).getroot()
except Exception: sys.exit(1)
for n in root.iter('node'):
    if sys.argv[2] in (n.get('text') or '', n.get('content-desc') or ''):
        b = list(map(int, re.findall(r'\d+', n.get('bounds'))))
        print((b[0]+b[2])//2, (b[1]+b[3])//2); sys.exit(0)
sys.exit(1)
PY
}
wait_text() { # $1 text $2 seconds $3 dump-name
  local end=$((SECONDS+$2))
  while [ $SECONDS -lt $end ]; do dump "$3"; if center "$OUT/$3.xml" "$1" >/dev/null; then return 0; fi; sleep 2; done
  return 1
}
contains() { grep -q -- "$2" "$OUT/$1.xml" 2>/dev/null; }

adb install -r "$APK" | tee "$OUT/install.log"
# Emulator networking can lag the boot; the app itself is also checked offline below.
for i in $(seq 1 60); do adb shell ping -c 1 -W 2 orunvoca.co.kr >/dev/null 2>&1 && break; sleep 2; done
adb shell getprop ro.build.version.release > "$OUT/android-version.txt"
adb shell am force-stop com.android.chrome || true

# 1. Cold launch: branded splash, then the live login page inside the app.
adb shell am start -n $PKG/.MainActivity >/dev/null
sleep 1.2; shot 01-splash
check "login page loads inside the app" "wait_text 'Google로 로그인' 120 02-login"
sleep 2; shot 02-login
check "app is in front on login page" "resumed | grep -q $PKG/.MainActivity"
python3 - "$OUT/02-login.png" <<'PY' | tee -a "$OUT/summary.txt"
import struct, zlib, sys
data = open(sys.argv[1], 'rb').read()
w, h = struct.unpack('>II', data[16:24])
print(f"login screenshot {w}x{h}")
PY

# 2. Staff Google sign-in must open in a Custom Tab over the app (not a separate browser app task),
#    for accounts.google.com, with the app callback as the final redirect target.
xy=$(center "$OUT/02-login.xml" 'Google로 로그인')
adb shell input tap $xy
sleep 8; shot 03-google-tab; dump 03-google-tab
resumed | tee "$OUT/03-resumed.txt"
adb shell dumpsys activity activities > "$OUT/03-activities.txt"
check "Google sign-in opened in a Custom Tab" "grep -q -i 'customtabs' '$OUT/03-resumed.txt'"
check "Custom Tab shows Google sign-in" "contains 03-google-tab 'accounts.google.com' || contains 03-google-tab 'Google' "
check "Custom Tab runs in the app task" "awk '/Task id/{t=\$0} /CustomTabActivity/{print t; exit}' '$OUT/03-activities.txt' | grep -q $PKG"

# 3. Cancelling returns to the app with a usable login page.
grep -q -i 'customtabs' "$OUT/03-resumed.txt" && adb shell input keyevent 4
sleep 3
check "back returns to the app" "resumed | grep -q $PKG/.MainActivity"
check "login page is usable again after cancel" "wait_text 'Google로 로그인' 60 04-after-cancel"
shot 04-after-cancel

# 4. An unsolicited callback (no sign-in started by the app) must be ignored.
adb shell am start -a android.intent.action.VIEW -d 'com.orunvoca.app://auth-callback#access_token=forged&refresh_token=forged' $PKG >/dev/null
sleep 5; dump 05-forged; shot 05-forged-callback
check "unsolicited callback ignored (still on login page)" "contains 05-forged 'Google로 로그인'"

# 5. Offline: branded connection screen, then recovery.
adb shell am force-stop $PKG
adb shell svc wifi disable; adb shell svc data disable
sleep 3
adb shell am start -n $PKG/.MainActivity >/dev/null
check "offline screen shown" "wait_text '연결할 수 없어요' 45 06-offline"
sleep 1; shot 06-offline
adb shell svc wifi enable; adb shell svc data enable
# No tap: the app must reopen by itself once the connection returns.
check "reconnect reopens the login page automatically" "wait_text 'Google로 로그인' 90 07-recovered"
sleep 1; shot 07-recovered

adb logcat -d -t 2000 > "$OUT/logcat.txt" 2>/dev/null || true
note "Environment: GitHub-hosted Linux VM, Android Emulator (not a physical device)."
exit $fail
