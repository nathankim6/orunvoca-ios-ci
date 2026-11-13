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

test('phone mode changes actual layout to 390pt and uses full content height', () => {
  assert.match(root, /phoneWidth:\s*CGFloat\s*=\s*390/);
  assert.match(root, /\.frame\(width:\s*model\.phoneMode\s*\?\s*min\(phoneWidth, geometry\.size\.width\)\s*:\s*geometry\.size\.width,\s*height:\s*geometry\.size\.height\)/);
  assert.match(root, /maxWidth:\s*\.infinity, maxHeight:\s*\.infinity, alignment:\s*\.center/);
  assert.doesNotMatch(root, /scaleEffect|aspectRatio|clipped\(/);
});

test('compact Korean picker shares the existing window toolbar', () => {
  assert.match(app, /windowToolbarStyle\(\.unifiedCompact\)/);
  assert.match(root, /ToolbarItem\(placement:\s*\.principal\)/);
  assert.match(root, /Picker\("화면 모드", selection:\s*\$model\.phoneMode\)/);
  assert.match(root, /Text\("데스크톱"\)\.tag\(false\)/);
  assert.match(root, /Text\("휴대폰"\)\.tag\(true\)/);
  assert.match(root, /\.controlSize\(\.small\)/);
  assert.doesNotMatch(root, /navigationTitle|safeAreaInset|VStack/);
});

test('legacy sections cannot route away from online; phone launch flag is explicit', () => {
  assert.match(app, /ProcessInfo\.processInfo\.arguments\.contains\("--phone-mode"\)/);
  assert.doesNotMatch(app, /firstIndex\(of:\s*"--section"\)|model\.selection/);
  assert.match(app, /CommandGroup\(replacing:\s*\.help\)/);
});

test('runtime smoke validates real viewport and removed UI in all launch modes', () => {
  for (const expected of ['AXWebArea', 'AXOutline', 'width - 390', 'webCenter - windowCenter', 'height >= window.size[1] - 150', '오프라인 단어장']) {
    assert.ok(smoke.includes(expected), `missing runtime assertion: ${expected}`);
  }
  assert.match(smoke, /check online desktop --section online/);
  assert.match(smoke, /check removed-section desktop --section offline/);
  assert.match(smoke, /check removed-info desktop --section info/);
  assert.match(smoke, /check phone phone --phone-mode/);
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
    const short = fixture(); short.rows[2].size[1] = 400;
    assert.notEqual(run(short).status, 0);
    const offCenter = fixture(); offCenter.rows[2].position[0] = 100;
    assert.notEqual(run(offCenter).status, 0);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
