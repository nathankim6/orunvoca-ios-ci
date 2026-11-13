#!/bin/bash
# Requires a logged-in macOS GUI runner with Accessibility and screen-capture access.
# Inspects real online WKWebView viewport dimensions, not a decorative phone frame.
# Usage: runtime-smoke.sh APP OUT              production app: launch/layout checks
#        runtime-smoke.sh APP OUT pronunciation  QA_SMOKE app only: native TTS bridge checks
# Never logs in, fills, submits or saves anything on the website.
set -uo pipefail
APP="${1:?Usage: runtime-smoke.sh APP OUT [pronunciation]}"; OUT="${2:?Usage: runtime-smoke.sh APP OUT [pronunciation]}"
MODE_ARG="${3:-layout}"
mkdir -p "$OUT"; FAIL=0; PID=""
BIN="$APP/Contents/MacOS/OrunVoca"
stop() { if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; PID=""; fi; }
trap stop EXIT
ax() {
  osascript -l JavaScript <<'JXA'
function run() {
  const p = Application("System Events").processes.byName("OrunVoca");
  const window = p.windows[0], rows = [];
  let count = 0;
  function get(el, key) { try { return el[key](); } catch (_) { return null; } }
  function walk(el, depth, inWeb) {
    if (depth > 30 || ++count > 8000) return;
    const role = get(el, "role"), web = inWeb || role === "AXWebArea";
    rows.push({role, title:get(el,"title"), value:get(el,"value"), description:get(el,"description"),
      size:get(el,"size"), position:get(el,"position"), inWeb:web});
    const children = get(el,"uiElements") || [];
    for (const child of children) walk(child, depth + 1, web);
  }
  walk(window, 0, false);
  return JSON.stringify({window:{size:get(window,"size"),position:get(window,"position")}, rows});
}
JXA
}
validate() {
  node - "$1" "$2" <<'JS'
const fs = require('node:fs');
const [file, mode] = process.argv.slice(2);
const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
const {rows, window} = snapshot;
const text = rows.map(r => [r.title,r.value,r.description].filter(Boolean).join(' ')).join('\n');
const assert = (ok, message) => { if (!ok) throw Error(message); };
assert(/액세스 코드|로그아웃|학습 시작|학생 로그인/.test(text), 'Online study page has not loaded');
assert(!/오프라인 단어장|TSV 가져오기|TSV 내보내기|단어 추가/.test(text), 'Removed notebook UI is present');
assert(!rows.some(r => !r.inWeb && (r.role === 'AXOutline' || /sidebar|사이드바/i.test(`${r.title || ''} ${r.description || ''}`))), 'Native sidebar is present');
assert(text.includes('데스크톱') && text.includes('휴대폰'), 'Display-mode toolbar is missing');
assert(!/QA SMOKE|QA no-gesture|QA speak/.test(text), 'Test-only QA fixture is present in a layout/production run');
const web = rows.find(r => r.role === 'AXWebArea' && r.size && r.size[0] > 0);
assert(web && window.size && window.position && web.position, 'Missing real web viewport geometry');
const [width,height] = web.size;
assert(height >= window.size[1] - 150, `Viewport does not use available height: ${height}`);
if (mode === 'phone') {
  assert(Math.abs(width - 390) <= 4, `Phone web viewport should be 390pt, got ${width}`);
  const webCenter = web.position[0] + width / 2;
  const windowCenter = window.position[0] + window.size[0] / 2;
  assert(Math.abs(webCenter - windowCenter) <= 6, 'Phone web viewport is not centered');
} else {
  assert(width >= window.size[0] - 12, `Desktop web viewport does not fill window: ${width}/${window.size[0]}`);
}
console.log(`PASS ${mode}: online; no notebook/sidebar; web viewport ${width}x${height}`);
JS
}
check() {
  local NAME="$1" MODE="$2"; shift 2
  "$BIN" "$@" > "$OUT/app-$NAME.log" 2>&1 & PID=$!
  local OK=0
  for I in $(seq 1 30); do
    sleep 2
    if ! kill -0 "$PID" 2>/dev/null; then echo "FAIL $NAME: app exited"; tail -20 "$OUT/app-$NAME.log"; FAIL=1; stop; return; fi
    if ax > "$OUT/ax-$NAME.json" 2> "$OUT/ax-$NAME.err" && validate "$OUT/ax-$NAME.json" "$MODE" > "$OUT/check-$NAME.log" 2>&1; then OK=1; break; fi
  done
  screencapture -x "$OUT/screen-$NAME.png" 2>/dev/null || true
  if [ "$OK" = 1 ]; then cat "$OUT/check-$NAME.log"; else
    echo "FAIL $NAME: runtime checks did not pass"; cat "$OUT/ax-$NAME.err"; cat "$OUT/check-$NAME.log" 2>/dev/null || true; FAIL=1
  fi
  stop
}

if [ "$MODE_ARG" = "layout" ]; then
check online desktop --section online
check removed-section desktop --section offline
check removed-info desktop --section info
check phone phone --phone-mode
# Production must ignore the test-only launch argument (no QA fixture is compiled in).
check prod-ignores-qa-arg desktop --qa-pronunciation
exit "$FAIL"
fi
[ "$MODE_ARG" = "pronunciation" ] || { echo "Unknown mode: $MODE_ARG"; exit 2; }

# ---- QA_SMOKE pronunciation bridge (test-only build) ----
# Real path: trusted HTTPS main frame -> real mouse click (isTrusted) -> orunExport gesture ->
# orunPronunciation native handler -> AVSpeechSynthesizer -> delegate didFinish -> JS reply.
/usr/libexec/PlistBuddy -c 'Print :OrunBuildFlavor' "$APP/Contents/Info.plist" 2>/dev/null | grep -qx QA_SMOKE \
  || { echo "FAIL: pronunciation mode requires the QA_SMOKE test build, refusing $APP"; exit 2; }
JXA="$OUT/qa-ax.js"
cat > "$JXA" <<'QAJXA'
ObjC.import('CoreGraphics');
function run(argv) {
  const [pid, action, label] = argv;
  const se = Application("System Events");
  const p = se.processes.whose({unixId: Number(pid)})[0];
  const window = p.windows[0], rows = [];
  let count = 0;
  function get(el, key) { try { return el[key](); } catch (_) { return null; } }
  function walk(el, depth, inWeb) {
    if (depth > 30 || ++count > 8000) return;
    const role = get(el, "role"), web = inWeb || role === "AXWebArea";
    rows.push({el, role, text:[get(el,"title"),get(el,"value"),get(el,"description")].filter(v => typeof v === "string" && v).join(" "),
      size:get(el,"size"), position:get(el,"position"), inWeb:web});
    for (const child of (get(el,"uiElements") || [])) walk(child, depth + 1, web);
  }
  walk(window, 0, false);
  if (action === "dump") return JSON.stringify(rows.map(({el, ...r}) => r));
  const target = rows.find(r => r.inWeb && r.role === "AXButton" && r.text.includes(label) && r.size && r.position);
  if (!target) throw Error("QA button not found: " + label);
  p.frontmost = true; delay(0.5);
  if (action === "press") { target.el.actions.byName("AXPress").perform(); return "AXPress " + label; }
  // Real HID-level mouse click at the element centre: WebKit dispatches trusted pointer/click events.
  const pt = {x: target.position[0] + target.size[0] / 2, y: target.position[1] + target.size[1] / 2};
  for (const type of [$.kCGEventMouseMoved, $.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) {
    $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, type, pt, $.kCGMouseButtonLeft));
    delay(0.12);
  }
  return "CGEvent mouse click " + label + " at " + Math.round(pt.x) + "," + Math.round(pt.y);
}
QAJXA
qa_dump() { osascript -l JavaScript "$JXA" "$PID" dump > "$OUT/qa-ax-$1.json" 2> "$OUT/qa-ax-$1.err"; }
# Prints the first AX text matching REGEX; exit 0 only on match.
qa_match() {
  node - "$1" "$2" <<'QANODE'
const fs = require('node:fs');
const [file, pattern] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const hit = rows.map(r => r.text).find(t => new RegExp(pattern).test(t));
if (!hit) process.exit(1);
console.log(hit);
QANODE
}
qa_line() { qa_match "$OUT/qa-ax-$1.json" "$2" 2>/dev/null || echo "(no AX text matching $2)"; }
qa_wait() { # NAME PASS_REGEX SECONDS STATUS_REGEX
  local I
  for I in $(seq 1 "$3"); do
    if ! kill -0 "$PID" 2>/dev/null; then echo "FAIL $1: app exited"; FAIL=1; return 1; fi
    if qa_dump "$1" && qa_match "$OUT/qa-ax-$1.json" "$2" > "$OUT/qa-$1.txt" 2>/dev/null; then echo "PASS $1: $(cat "$OUT/qa-$1.txt")"; return 0; fi
    sleep 1
  done
  echo "FAIL $1: expected /$2/; actual: $(qa_line "$1" "$4")"; cat "$OUT/qa-ax-$1.err" 2>/dev/null; FAIL=1; return 1
}
qa_shot() { screencapture -x "$OUT/screen-qa-$1.png" 2>/dev/null; [ -s "$OUT/screen-qa-$1.png" ] || echo "WARN: screenshot $1 unavailable (screen-recording permission?)"; }
qa_click() { # LABEL IDLE_TEXT NAME
  local METHOD
  METHOD="$(osascript -l JavaScript "$JXA" "$PID" click "$1" 2>&1)" || { echo "FAIL $3: click failed: $METHOD"; FAIL=1; return 1; }
  sleep 2
  # Fallback only if the HID click never reached the page (status still idle). Recorded honestly.
  if qa_dump "$3-click" && qa_match "$OUT/qa-ax-$3-click.json" "^$2\$" >/dev/null 2>&1; then
    METHOD="$METHOD; no page reaction, fallback $(osascript -l JavaScript "$JXA" "$PID" press "$1" 2>&1)"
  fi
  echo "$3 input: $METHOD" | tee -a "$OUT/qa-input-methods.log"
}
{ echo "environment=${RUNTIME_ENVIRONMENT_LABEL:-macOS host (not verified as a physical end-user device)}"
  sw_vers; uname -m
  echo "installed English voices (say -v ?):"; say -v '?' 2>&1 | grep -E 'en[_-](US|GB)' || echo "NONE"
} > "$OUT/qa-environment.txt" 2>&1
OS_ACTIVITY_DT_MODE=YES "$BIN" --qa-pronunciation > "$OUT/app-qa-pronunciation.log" 2>&1 & PID=$!
if qa_wait ready 'QA SMOKE test build only' 90 'QA' && qa_wait online '액세스 코드|학생 로그인|로그아웃|학습 시작' 30 '.' \
   && qa_wait gate '^QA no-gesture rejected: Not allowed$' 20 '^QA (gate|no-gesture)'; then
  qa_shot 1-ready-gate-rejected
  qa_click 'QA speak hello' 'QA speak idle' speak
  qa_wait speak '^QA finished: finished in [0-9]+ms, trusted click true$' 45 '^QA (speak|finished)'; qa_shot 2-speak-finished
  qa_click 'QA invalid language' 'QA invalid idle' invalid
  qa_wait invalid '^QA invalid rejected: Invalid pronunciation request$' 15 '^QA invalid'; qa_shot 3-invalid-rejected
  qa_click 'QA cancel speech' 'QA cancel idle' cancel
  qa_wait cancel '^QA cancel: speak rejected Pronunciation cancelled; stop stopped$' 20 '^QA cancel'; qa_shot 4-cancelled
else qa_shot failed; FAIL=1; fi
stop
# Supplementary delegate evidence; the JS "finished" reply is only produced by didFinish.
log show --last 10m --style compact --predicate 'eventMessage CONTAINS "QA_SMOKE AVSpeechSynthesizer"' > "$OUT/qa-unified-log.txt" 2>&1 || true
if grep -hq 'QA_SMOKE AVSpeechSynthesizer didFinish' "$OUT/app-qa-pronunciation.log" "$OUT/qa-unified-log.txt" 2>/dev/null; then
  echo "Native delegate log: didFinish observed"; else echo "WARN: didFinish log line not captured (JS reply status is the assertion)"; fi
[ "$FAIL" = 0 ] && echo "PASS pronunciation: gesture-gated native AVSpeechSynthesizer completion, invalid rejection, cancellation"
exit "$FAIL"
