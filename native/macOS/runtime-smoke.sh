#!/bin/bash
# Launches the built app on a macOS runner and checks real windows through Accessibility. Evidence goes to $OUT.
set -uo pipefail
APP="$1"; OUT="$2"; mkdir -p "$OUT"; FAIL=0
BIN="$APP/Contents/MacOS/OrunVoca"
ax() { osascript -l JavaScript -e 'function run(){const se=Application("System Events");const p=se.processes.byName("OrunVoca");const out=[];const seen={n:0};function walk(el,d){if(d>18||seen.n>4000)return;let kids=[];try{kids=el.uiElements();}catch(e){return;}for(const k of kids){seen.n++;let line=[];for(const f of ["role","title","value","description"]){try{const v=k[f]();if(v!==null&&v!==undefined&&String(v).length)line.push(String(v).slice(0,200));}catch(e){}}if(line.length>1)out.push(line.join(" | "));walk(k,d+1);}}walk(p.windows[0],0);return out.join("\n");}' 2>&1; }
launch() { "$BIN" "$@" > "$OUT/app-$1-$2.log" 2>&1 & echo $! > "$OUT/pid"; }
stop() { kill "$(cat "$OUT/pid")" 2>/dev/null; sleep 2; }
check() { # name, expected text, launch args...
  local NAME="$1" EXPECT="$2"; shift 2; launch "$@"; local OK=0
  for I in $(seq 1 30); do sleep 2
    if ! kill -0 "$(cat "$OUT/pid")" 2>/dev/null; then echo "FAIL $NAME: app exited"; cat "$OUT/app-$1-$2.log" | tail -20; FAIL=1; return; fi
    ax > "$OUT/ax-$NAME.txt"; if grep -q "$EXPECT" "$OUT/ax-$NAME.txt"; then OK=1; break; fi
  done
  screencapture -x "$OUT/screen-$NAME.png" 2>/dev/null || true
  osascript -e 'tell application "System Events" to tell (first process whose name is "OrunVoca") to get {name, size} of window 1' > "$OUT/window-$NAME.txt" 2>&1 || true
  if [ "$OK" = 1 ]; then echo "PASS $NAME: found '$EXPECT'"; else echo "FAIL $NAME: '$EXPECT' not found"; head -c 2000 "$OUT/ax-$NAME.txt"; FAIL=1; fi
  stop
}
check offline "나만의 단어장을 만들어 보세요" --section offline
check info "옳은영어 어휘플랫폼" --section info
check online "액세스 코드" --section online
exit $FAIL
