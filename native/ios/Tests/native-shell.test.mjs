import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../OrunVoca/OrunVocaApp.swift', import.meta.url), 'utf8');
const web = readFileSync(new URL('../OrunVoca/WebStudyView.swift', import.meta.url), 'utf8');
const plist = readFileSync(new URL('../OrunVoca/Info.plist', import.meta.url), 'utf8');

test('iOS launches the online study view directly without tab navigation', () => {
  assert.match(app, /rootViewController = ShellViewController\(\)/);
  assert.match(app, /WebStudyView\(session: session\)/);
  assert.equal((app.match(/WebStudyView\(/g) || []).length, 1);
  assert.doesNotMatch(app, /TabView|tabItem|NotebookView\(|NativeSettingsView|NavigationStack/);
});

test('iOS does not initialize or expose notebook data and leaves stored data intact', () => {
  assert.doesNotMatch(app, /NotebookStore\(|environmentObject|removeAll\(|removeItem\(|UserDefaults|FileManager/);
  assert.doesNotMatch(app, /오프라인 단어장|모두 삭제/);
});

test('legacy compiled views retain ValueState property-wrapper compatibility', () => {
  assert.match(app, /typealias ValueState<Value> = SwiftUI\.State<Value>/);
});

test('browser-style header is gone and a branded launch screen continues into the splash', () => {
  assert.doesNotMatch(web, /Text\("옳은VOCA"\)\.font\(\.headline\)/);
  assert.doesNotMatch(web, /accessibilityLabel\("이전 화면"\)/);
  assert.match(plist, /<key>UIColorName<\/key><string>LaunchBackground<\/string>/);
  assert.match(plist, /<key>UIImageName<\/key><string>LaunchLogo<\/string>/);
  assert.match(app, /Image\("LaunchLogo"\)/);
});

test('Google sign-in is handed to the system auth sheet only for the project authorize endpoint', () => {
  assert.match(web, /import AuthenticationServices/);
  assert.match(web, /static let authHost = "jpanpwbdlhsxnyaldddm\.supabase\.co"/);
  assert.match(web, /url\.path == "\/auth\/v1\/authorize"/);
  assert.match(web, /ASWebAuthenticationSession\(url: authURL, callbackURLScheme: NativeAuth\.scheme\)/);
  assert.match(web, /prefersEphemeralWebBrowserSession = true/);
  // Result is only loaded back into a trusted orunvoca.co.kr URL.
  assert.match(web, /guard let url = target\.url, ExportPolicy\.trusted\(url\) else/);
  assert.match(web, /if webView === self\.webView, NativeAuth\.isAuthorize\(url\) \{\s*decisionHandler\(\.cancel\)/);
});
