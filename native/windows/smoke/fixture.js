'use strict';
// TEST-ONLY synthetic fixture. Lives outside build.files, so it is never packed into app.asar.
// It is served by the smoke harness through session.protocol.handle('https') for the
// production origin only. It is NOT the shipped orunvoca.co.kr website.
const { SITE_ORIGIN } = require('../src/security');

const TRUSTED_ORIGIN = SITE_ORIGIN;
const PARTITION = 'persist:orunvoca';
const WAV_PATH = '/fixture/beep.wav';

// Tiny mono 16-bit PCM WAV (sine beep) used as a fake pronunciation clip.
function buildWav({ sampleRate = 8000, ms = 150, freq = 880 } = {}) {
  const n = Math.round((sampleRate * ms) / 1000);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 80, (n - i) / 80);
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000 * fade), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Synthetic test paper written into the print popup (mirrors the site's CreateTestPaper flow).
const PAPER_MARK = 'SYNTHETIC TEST PAPER';
function buildPaperHtml() {
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + PAPER_MARK + ' - 시험지 인쇄</title>' +
    "<style>body{font:16px 'Malgun Gothic',sans-serif;margin:24px}h1{font-size:20px}li{margin:8px 0}</style></head><body>" +
    '<h1>' + PAPER_MARK + ' (CI fixture, no real student data)</h1>' +
    '<ol><li>apple → ________</li><li>book → ________</li><li>river → ________</li></ol>' +
    '<p>정답: 사과, 책, 강</p></body></html>';
}

function buildFixtureHtml() {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>옳은VOCA smoke fixture</title>
<style>
body{margin:0;font:16px 'Malgun Gothic',sans-serif;background:#eef2ff;color:#111827}
.banner{background:#b91c1c;color:#fff;padding:8px 12px;font-weight:700}
.wrap{display:flex;gap:12px;padding:12px}
.card{flex:1;background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 3px #0002}
#vw{font-size:28px;font-weight:700}
button{font-size:16px;padding:10px 14px;border-radius:8px;border:0;background:#2563eb;color:#fff}
@media (max-width:400px){body{background:#fef3c7}.wrap{flex-direction:column}#mode::after{content:' (phone-width media query matched)'}}
</style></head><body>
<div class="banner">SYNTHETIC LOCAL TEST FIXTURE - served by the CI smoke harness, not the shipped orunvoca.co.kr site</div>
<div class="wrap">
  <div class="card"><div>viewport (window.innerWidth x innerHeight)</div><div id="vw"></div><div id="mode"></div><div id="load"></div></div>
  <div class="card"><button id="speak">발음 듣기 (synthetic beep)</button><pre id="audio" style="white-space:pre-wrap"></pre></div>
</div>
<script>
(function () {
  var PAPER = ${JSON.stringify(buildPaperHtml())};
  var PAPER_MARK = ${JSON.stringify(PAPER_MARK)};
  var loadId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var paint = function () {
    document.getElementById('vw').textContent = innerWidth + ' x ' + innerHeight;
    document.getElementById('mode').textContent = innerWidth <= 400 ? 'phone viewport' : 'desktop viewport';
  };
  addEventListener('resize', paint); paint();
  document.getElementById('load').textContent = 'document loadId ' + loadId;
  async function playPronunciation() {
    var r = { fetched: false, decoded: false };
    try {
      var res = await fetch('${WAV_PATH}', { cache: 'no-store' });
      r.status = res.status; var buf = await res.arrayBuffer(); r.bytes = buf.byteLength; r.fetched = res.ok;
      var ctx = new OfflineAudioContext(1, 8000, 8000);
      var ab = await ctx.decodeAudioData(buf);
      r.decoded = true; r.durationMs = Math.round(ab.duration * 1000); r.sampleRate = ab.sampleRate;
    } catch (e) { r.error = String(e); }
    try {
      var a = new Audio('${WAV_PATH}');
      r.play = await Promise.race([
        a.play().then(function () { return new Promise(function (ok) { a.onended = function () { ok('ended'); }; setTimeout(function () { ok('playing-no-ended'); }, 3000); }); }),
        new Promise(function (ok) { setTimeout(function () { ok('timeout'); }, 5000); })
      ]);
    } catch (e) { r.play = 'error: ' + (e && e.name); }
    r.speechSynthesis = typeof speechSynthesis;
    document.getElementById('audio').textContent = JSON.stringify(r, null, 1);
    return r;
  }
  document.getElementById('speak').onclick = function () { playPronunciation(); };
  window.__fixture = {
    ready: true,
    state: function () {
      var nav = performance.getEntriesByType('navigation')[0];
      return { ready: true, loadId: loadId, innerWidth: innerWidth, innerHeight: innerHeight, dpr: devicePixelRatio,
        phoneMQ: matchMedia('(max-width: 400px)').matches, url: location.href, navType: nav ? nav.type : null,
        transform: getComputedStyle(document.documentElement).transform,
        bridge: typeof window.orunShell, nodeRequire: typeof window.require, nodeProcess: typeof window.process };
    },
    playPronunciation: playPronunciation,
    tryNavigate: function (u) { location.href = u; return true; },
    tryPopup: function (u) { return String(window.open(u)); },
    // Same calls as the site: window.open('', '_blank'), document.write(html), (print()), close().
    openPrintPopup: function () {
      var w = window.open('', '_blank');
      if (!w) return { opened: false };
      window.__printWin = w;
      w.document.write(PAPER);
      w.document.close();
      return window.__fixture.printPopupState();
    },
    printPopupState: function () {
      var w = window.__printWin; var r = { opened: !!w, closed: w ? w.closed : null };
      try {
        r.childOrigin = w.location.origin; r.childHref = w.location.href; r.title = w.document.title;
        r.sameOriginAccess = w.document.body.innerText.indexOf(PAPER_MARK) >= 0;
        r.childHasRequire = typeof w.require; r.childHasProcess = typeof w.process; r.childHasBridge = typeof w.orunShell;
      } catch (e) { r.sameOriginAccess = false; r.error = String(e); }
      return r;
    },
    // Nested popups attempted from inside the popup's own realm.
    printPopupNested: function () {
      var w = window.__printWin;
      return { blank: String(w.eval("window.open('', '_blank')")), external: String(w.eval("window.open('http://example.invalid/')")) };
    },
    // Navigation attempts: popup self-navigation and opener-initiated navigation of the popup.
    printPopupNavigate: function (u) {
      var w = window.__printWin;
      try { w.eval('location.href = ' + JSON.stringify(u)); } catch (e) {}
      try { w.location.href = u; } catch (e) {}
      return true;
    },
    openSecondPrintPopup: function () { return String(window.open('', '_blank')); },
    closePrintPopup: function () { if (window.__printWin) window.__printWin.close(); window.__printWin = null; return true; },
    notificationPermission: function () {
      return Promise.resolve(Notification.requestPermission()).then(String, function (e) { return 'error: ' + e; });
    }
  };
})();
</script></body></html>
`;
}

function buildRoutes() {
  return {
    '/': { type: 'text/html; charset=utf-8', body: Buffer.from(buildFixtureHtml(), 'utf8').toString('base64') },
    [WAV_PATH]: { type: 'audio/wav', body: buildWav().toString('base64') }
  };
}

function probeOptions(extra = {}) {
  return { trustedOrigin: TRUSTED_ORIGIN, partition: PARTITION, routes: buildRoutes(), wavPath: WAV_PATH,
    installIntercept: true, reloadAfterIntercept: false, ...extra };
}

module.exports = { TRUSTED_ORIGIN, PARTITION, WAV_PATH, PAPER_MARK, buildPaperHtml, buildWav, buildFixtureHtml, buildRoutes, probeOptions };
