import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const app = readFileSync(new URL('../OrunVocaMacApp.swift', import.meta.url), 'utf8');
const smokeURL = new URL('../runtime-smoke.sh', import.meta.url);
const smoke = readFileSync(smokeURL, 'utf8');
const root = app.slice(app.indexOf('struct MacRootView'));

test('Mac opens online without outer sidebar or notebook initialization', () => {
  assert.doesNotMatch(app, /NavigationSplitView|NavigationStack|\bList\s*\{|MacNotebookStore\(|MacNotebookView\(|MacSection/);
  assert.match(root, /MacWebStudyView\(\)/);
  assert.doesNotMatch(app, /removeAll\(|removeItem\(|UserDefaults.*remove/);
});

test('mode changes preserve one structural study-view identity', () => {
  assert.equal((root.match(/MacWebStudyView\(\)/g) || []).length, 1);
  assert.doesNotMatch(root, /\bif\s|\bswitch\s|\.id\(|\.onChange\(|\.load\(|\.reload\(/);
});

const modeEnum = app.slice(app.indexOf('enum MacDisplayMode'), app.indexOf('@MainActor final class MacAppModel'));

test('display mode is a three-way enum: desktop fills, tablet 768pt, phone 390pt', () => {
  assert.match(modeEnum, /enum MacDisplayMode: String, CaseIterable, Hashable \{\s*case desktop, tablet, phone\b/);
  assert.match(modeEnum, /static let tabletWidth: CGFloat = 768\b/);
  assert.match(modeEnum, /static let phoneWidth: CGFloat = 390\b/);
  assert.match(modeEnum, /case \.desktop: return nil/);
  assert.match(modeEnum, /case \.tablet: return Self\.tabletWidth/);
  assert.match(modeEnum, /case \.phone: return Self\.phoneWidth/);
  assert.match(modeEnum, /guard let limit = maxWidth else \{ return width \}\s*return min\(limit, width\)/);
  assert.doesNotMatch(app, /\bphoneMode\b/, 'legacy Bool phoneMode must be replaced by the display-mode enum');
  assert.match(app, /@Published var displayMode = MacDisplayMode\.launchMode\(ProcessInfo\.processInfo\.arguments\)/);
});

test('every mode changes actual layout width of the same view and uses full content height', () => {
  assert.match(root, /\.frame\(width:\s*model\.displayMode\.viewWidth\(available:\s*geometry\.size\.width\),\s*height:\s*geometry\.size\.height\)/);
  assert.match(root, /maxWidth:\s*\.infinity, maxHeight:\s*\.infinity, alignment:\s*\.center/);
  assert.doesNotMatch(root, /scaleEffect|aspectRatio|clipped\(/);
  assert.doesNotMatch(app, /scaleEffect|aspectRatio|\.id\(/);
});

test('display-mode width math executes natively: 768 vs 390, clamped to narrow windows, launch flags', async (t) => {
  const probe = spawnSync('xcrun', ['--sdk', 'macosx', '--find', 'swiftc'], { encoding: 'utf8' });
  if (probe.status !== 0) { t.skip('swiftc unavailable on this host'); return; }
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const temp = mkdtempSync(join(tmpdir(), 'orun-mac-display-mode-'));
  try {
    const src = join(temp, 'main.swift');
    writeFileSync(src, `import Foundation\n${modeEnum}\n` + `
func expect(_ ok: Bool, _ message: String) { if !ok { print("FAIL " + message); exit(1) } }
expect(MacDisplayMode.allCases == [.desktop, .tablet, .phone], "order")
for available in [1000.0, 1200.0, 769.0, 768.0, 760.0, 500.0, 391.0, 390.0, 300.0, 0.0] as [CGFloat] {
  expect(MacDisplayMode.desktop.viewWidth(available: available) == available, "desktop fills \\(available)")
  expect(MacDisplayMode.tablet.viewWidth(available: available) == min(768, available), "tablet \\(available)")
  expect(MacDisplayMode.phone.viewWidth(available: available) == min(390, available), "phone \\(available)")
}
expect(MacDisplayMode.tablet.viewWidth(available: 1000) == 768 && MacDisplayMode.phone.viewWidth(available: 1000) == 390, "768 vs 390")
expect(MacDisplayMode.phone.viewWidth(available: -5) == 0, "negative clamps to zero")
expect(MacDisplayMode.launchMode(["OrunVoca"]) == .desktop, "default desktop")
expect(MacDisplayMode.launchMode(["OrunVoca", "--phone-mode"]) == .phone, "legacy phone flag")
expect(MacDisplayMode.launchMode(["OrunVoca", "--tablet-mode"]) == .tablet, "tablet flag")
expect(MacDisplayMode.launchMode(["OrunVoca", "--tablet-mode", "--phone-mode"]) == .phone, "phone flag wins")
expect(MacDisplayMode.launchMode(["OrunVoca", "--section", "offline"]) == .desktop, "legacy section ignored")
expect(MacDisplayMode.launchMode(["OrunVoca", "--Tablet-Mode", "tablet"]) == .desktop, "exact flags only")
print("PASS display-mode math")
`);
    const bin = join(temp, 'check');
    const build = spawnSync('xcrun', ['--sdk', 'macosx', 'swiftc', '-Onone', src, '-o', bin], { encoding: 'utf8', timeout: 240000 });
    assert.equal(build.status, 0, `${build.signal} ${build.error} ${build.stderr}`);
    // Compilation above is always required. Execution can be skipped only explicitly (hosts that cannot exec fresh binaries).
    if (process.env.ORUN_SKIP_NATIVE_EXEC === '1') { t.diagnostic('compiled; execution skipped by ORUN_SKIP_NATIVE_EXEC=1'); return; }
    const run = spawnSync(bin, [], { encoding: 'utf8', timeout: 60000 });
    assert.equal(run.status, 0, `${run.signal} ${run.error} ${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /PASS display-mode math/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('compact Korean picker shares the existing window toolbar', () => {
  assert.match(app, /windowToolbarStyle\(\.unifiedCompact\)/);
  assert.match(root, /ToolbarItem\(placement:\s*\.principal\)/);
  assert.match(root, /Picker\("화면 모드", selection:\s*\$model\.displayMode\)/);
  // Exactly three segments in the order 데스크톱, 태블릿, 휴대폰.
  assert.match(root, /Text\("데스크톱"\)\.tag\(MacDisplayMode\.desktop\)\s*Text\("태블릿"\)\.tag\(MacDisplayMode\.tablet\)\s*Text\("휴대폰"\)\.tag\(MacDisplayMode\.phone\)\s*\}/);
  assert.equal((root.match(/\.tag\(/g) || []).length, 3);
  assert.match(root, /\.controlSize\(\.small\)/);
  assert.match(root, /\.pickerStyle\(\.segmented\)/);
  // Widened from the two-segment 164pt so "데스크톱" is not truncated in a third-width segment.
  const width = Number((root.match(/\.controlSize\(\.small\)[\s\S]*?\.frame\(width:\s*(\d+)\)/) || [])[1]);
  assert.ok(width >= 240 && width <= 300, `picker width ${width}`);
  assert.match(root, /accessibilityIdentifier\("study-display-mode"\)/);
  assert.match(root, /\.help\("[^"]*태블릿은 768포인트[^"]*휴대폰은 390포인트[^"]*"\)/);
  assert.doesNotMatch(root, /navigationTitle|safeAreaInset|VStack/);
});

test('legacy sections cannot route away from online; phone/tablet launch flags are explicit', () => {
  assert.match(modeEnum, /arguments\.contains\("--phone-mode"\)\s*\{\s*return \.phone\s*\}\s*if arguments\.contains\("--tablet-mode"\)\s*\{\s*return \.tablet\s*\}\s*return \.desktop/);
  assert.match(app, /MacDisplayMode\.launchMode\(ProcessInfo\.processInfo\.arguments\)/);
  assert.doesNotMatch(app, /firstIndex\(of:\s*"--section"\)|model\.selection/);
  assert.match(app, /CommandGroup\(replacing:\s*\.help\)/);
});

test('runtime smoke validates real viewport and removed UI in all launch modes', () => {
  for (const expected of ['AXWebArea', 'AXOutline', 'width - 390', 'width - tabletTarget', 'Math.min(768, window.size[0])', 'webCenter - windowCenter', 'height >= window.size[1] - 150', '오프라인 단어장',
    "text.includes('태블릿')", 'Display-mode order must be 데스크톱/태블릿/휴대폰', 'Unknown display mode']) {
    assert.ok(smoke.includes(expected), `missing runtime assertion: ${expected}`);
  }
  assert.match(smoke, /check online desktop --section online/);
  assert.match(smoke, /check removed-section desktop --section offline/);
  assert.match(smoke, /check removed-info desktop --section info/);
  assert.match(smoke, /check tablet tablet --tablet-mode\ncheck phone phone --phone-mode\n/);
  assert.match(smoke, /check phone-over-tablet phone --tablet-mode --phone-mode/);
  assert.match(smoke, /check prod-ignores-qa-arg desktop --qa-pronunciation/);
  assert.match(smoke, /trap stop EXIT/);
  const syntax = spawnSync('bash', ['-n', smokeURL.pathname], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('embedded study view does not impose a desktop minimum wider than phone mode', () => {
  const web = readFileSync(new URL('../MacWebStudyView.swift', import.meta.url), 'utf8');
  const study = web.slice(web.indexOf('struct MacWebStudyView: View'));
  for (const match of study.matchAll(/\.frame\(minWidth:\s*(\d+)/g)) {
    assert.ok(Number(match[1]) <= 390, `Embedded view minimum ${match[1]} prevents phone layout`);
  }
  assert.match(study, /@StateObject/);
});

test('smoke checker accepts valid geometry and rejects notebook/sidebar and fake phone sizes', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const script = smoke.match(/<<'JS'\n([\s\S]*?)\nJS/)[1];
  const temp = mkdtempSync(join(tmpdir(), 'orun-native-smoke-check-'));
  const file = join(temp, 'snapshot.json');
  const fixture = (width = 390) => ({
    window: { size: [1000, 760], position: [100, 100] },
    rows: [
      { role: 'AXRadioButton', title: '데스크톱', inWeb: false },
      { role: 'AXRadioButton', title: '태블릿', inWeb: false },
      { role: 'AXRadioButton', title: '휴대폰', inWeb: false },
      { role: 'AXWebArea', title: '액세스 코드', inWeb: true, size: [width, 710], position: [100 + (1000 - width) / 2, 150] }
    ]
  });
  const run = (data, mode = 'phone') => {
    writeFileSync(file, JSON.stringify(data));
    return spawnSync(process.execPath, ['-', file, mode], { input: script, encoding: 'utf8' });
  };
  try {
    assert.equal(run(fixture()).status, 0);
    assert.equal(run(fixture(1000), 'desktop').status, 0);
    assert.notEqual(run(fixture(480)).status, 0, '480pt web view must not masquerade as phone');
    assert.notEqual(run(fixture(390), 'desktop').status, 0, 'desktop must fill content width');
    const sidebar = fixture(); sidebar.rows.push({role:'AXOutline', inWeb:false});
    assert.notEqual(run(sidebar).status, 0);
    const notebook = fixture(); notebook.rows.push({role:'AXButton', title:'오프라인 단어장'});
    assert.notEqual(run(notebook).status, 0);
    const short = fixture(); short.rows[3].size[1] = 400;
    assert.notEqual(run(short).status, 0);
    const offCenter = fixture(); offCenter.rows[3].position[0] = 100;
    assert.notEqual(run(offCenter).status, 0);
    // Tablet: real 768pt centered viewport; phone/desktop widths must not masquerade as tablet.
    assert.equal(run(fixture(768), 'tablet').status, 0, run(fixture(768), 'tablet').stderr);
    assert.notEqual(run(fixture(390), 'tablet').status, 0, 'phone width is not tablet');
    assert.notEqual(run(fixture(1000), 'tablet').status, 0, 'desktop width is not tablet');
    assert.notEqual(run(fixture(700), 'tablet').status, 0, '700pt is not tablet on a 1000pt window');
    assert.notEqual(run(fixture(768), 'phone').status, 0, 'tablet width is not phone');
    assert.notEqual(run(fixture(768), 'desktop').status, 0, 'tablet width does not fill desktop');
    const tabletOff = fixture(768); tabletOff.rows[3].position[0] = 100;
    assert.notEqual(run(tabletOff, 'tablet').status, 0, 'tablet must be centered');
    const tabletShort = fixture(768); tabletShort.rows[3].size[1] = 400;
    assert.notEqual(run(tabletShort, 'tablet').status, 0, 'tablet must use full height');
    // Narrow window clamps tablet to the available width.
    const narrow = fixture(760); narrow.window.size[0] = 760; narrow.rows[3].position[0] = 100;
    assert.equal(run(narrow, 'tablet').status, 0, 'tablet clamps to a 760pt window');
    assert.notEqual(run(fixture(768), 'unknown').status, 0, 'unknown mode rejected');
    // Picker must show all three labels in order 데스크톱, 태블릿, 휴대폰.
    const noTablet = fixture(); noTablet.rows.splice(1, 1);
    assert.notEqual(run(noTablet).status, 0, 'missing 태블릿 segment');
    const swapped = fixture(); [swapped.rows[1], swapped.rows[2]] = [swapped.rows[2], swapped.rows[1]];
    assert.notEqual(run(swapped).status, 0, 'wrong segment order');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
