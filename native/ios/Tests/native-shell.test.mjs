import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../OrunVoca/OrunVocaApp.swift', import.meta.url), 'utf8');

test('iOS launches the online study view directly without tab navigation', () => {
  assert.match(app, /WindowGroup\s*\{\s*WebStudyView\(\)/);
  assert.equal((app.match(/WebStudyView\(\)/g) || []).length, 1);
  assert.doesNotMatch(app, /TabView|tabItem|NotebookView\(|NativeSettingsView|NavigationStack/);
});

test('iOS does not initialize or expose notebook data and leaves stored data intact', () => {
  assert.doesNotMatch(app, /NotebookStore\(|environmentObject|StateObject|removeAll\(|removeItem\(|UserDefaults|FileManager/);
  assert.doesNotMatch(app, /오프라인 단어장|모두 삭제/);
});

test('legacy compiled views retain ValueState property-wrapper compatibility', () => {
  assert.match(app, /typealias ValueState<Value> = SwiftUI\.State<Value>/);
});
