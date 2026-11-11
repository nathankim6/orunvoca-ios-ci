import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Public first screen only. No authentication, credentials, or production mutations.
// Known-working CI runtime. Never silently select a newer installed runtime.
const runtimeIdentifier = process.env.SMOKE_RUNTIME_IDENTIFIER || 'com.apple.CoreSimulator.SimRuntime.iOS-26-4';
const family = process.env.SMOKE_DEVICE_FAMILY;
if (!['iphone', 'ipad'].includes(family)) throw Error('SMOKE_DEVICE_FAMILY must be iphone or ipad');
const out = process.env.SMOKE_OUTPUT_DIR || path.join('runtime-smoke', family);
fs.mkdirSync(out, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(out, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
function run(args, timeout = 60000) {
  console.log(`xcrun ${args.join(' ')}`);
  try {
    const result = execFileSync('xcrun', args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
    if (result) console.log(result);
    return result;
  } catch (error) {
    console.error(error.stdout?.toString() || '', error.stderr?.toString() || '');
    throw error;
  }
}
function diagnostic(name, args) {
  // simctl list can hang even after bootstatus has completed. Evidence collection
  // must never turn a successful boot into a failure or mask the original error.
  try { write(name, run(args, 10000)); }
  catch (error) {
    console.warn(`Nonfatal diagnostic ${name}: ${error}`);
    try { write(`${name}.error.log`, String(error)); }
    catch (writeError) { console.warn(`Could not save diagnostic: ${writeError}`); }
  }
}
const devices = JSON.parse(run(['simctl', 'list', 'devices', 'available', '--json']));
const runtimes = JSON.parse(run(['simctl', 'list', 'runtimes', '--json']));
const types = JSON.parse(run(['simctl', 'list', 'devicetypes', '--json']));
write('available-devices.json', devices);
write('runtimes.json', runtimes);
write('device-types.json', types);
const selectedRuntime = runtimes.runtimes.find(r => r.identifier === runtimeIdentifier && r.isAvailable);
if (!selectedRuntime) throw Error(`Required pinned iOS runtime ${runtimeIdentifier} is unavailable; refusing newest-runtime fallback.`);
const choices = Object.entries(devices.devices)
  .filter(([runtime]) => runtime === runtimeIdentifier)
  .flatMap(([runtime, list]) => list.filter(d => d.isAvailable).map(d => ({ ...d, runtime })))
  .filter(d => d.name.startsWith(family === 'iphone' ? 'iPhone' : 'iPad'));
const score = d => family === 'iphone'
  ? (/iPhone (16|17) Pro Max/.test(d.name) ? 3 : d.name.includes('Pro Max') ? 2 : 1)
  : (/iPad Pro.*13-inch/.test(d.name) ? 3 : /iPad Pro.*12.9-inch/.test(d.name) ? 2 : 1);
choices.sort((a, b) => score(b) - score(a) || b.runtime.localeCompare(a.runtime, undefined, { numeric: true }) || b.name.localeCompare(a.name, undefined, { numeric: true }));
const device = choices[0];
if (!device) throw Error(`No available installed ${family} simulator on pinned runtime ${runtimeIdentifier}. This matrix leg must not be skipped.`);
const prefix = family === 'ipad' ? 'iPad' : 'iPhone';
const metadata = {
  appDisplayName: '옳은VOCA', family, device,
  runtime: selectedRuntime,
  runtimeSelection: { policy: 'required-pin-no-fallback', identifier: runtimeIdentifier },
  deviceType: types.devicetypes.find(t => t.identifier === device.deviceTypeIdentifier),
  preferredDeviceSelected: score(device) === 3,
  selectedAt: new Date().toISOString(),
};
write('device.json', metadata);
if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `SMOKE_UDID=${device.udid}\n`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `udid=${device.udid}\n`);
console.log(`Selected ${device.name} (${device.udid}), ${device.runtime}. Only this device will be booted.`);
try {
  if (device.state !== 'Booted') run(['simctl', 'boot', device.udid]);
  console.log('Cold boot allows 480 seconds for CoreSimulator/CoreLocation migration; this is not an app-launch timeout.');
  write(`${prefix}-bootstatus.log`, run(['simctl', 'bootstatus', device.udid, '-b'], 480000));
} catch (error) {
  write(`${prefix}-boot-error.log`, `${error}\n${error.stdout || ''}\n${error.stderr || ''}`);
  diagnostic(`${prefix}-boot-failure-state.json`, ['simctl', 'list', 'devices', 'available', '--json']);
  diagnostic(`${prefix}-boot-failure-booted.json`, ['simctl', 'list', 'devices', 'booted', '--json']);
  diagnostic(`${prefix}-boot-failure-runtimes.json`, ['simctl', 'list', 'runtimes', '--json']);
  throw error;
}
diagnostic(`${prefix}-booted-state.json`, ['simctl', 'list', 'devices', 'booted', '--json']);
run(['simctl', 'status_bar', device.udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3', '--batteryState', 'charged', '--batteryLevel', '100']);
if (process.env.SMOKE_PREPARE_FOR_XCTEST === '1') {
  // CI must still execute the separate mandatory XCTest step. This is device preparation,
  // not an app/runtime success claim. XCTest installs, cold-launches and verifies the UI.
  metadata.validationMode = 'device-preparation-before-mandatory-xctest';
  write('device.json', metadata);
  console.log('Device prepared; app installation, launch and loaded web/native UI must pass XCTest next.');
} else {
const app = process.env.SMOKE_APP_PATH || 'native/ios/build/DerivedData/Build/Products/Debug-iphonesimulator/OrunVoca.app';
run(['simctl', 'install', device.udid, app]);
let launched = false;
try {
  write(`${prefix}-launch.log`, run(['simctl', 'launch', device.udid, 'com.orunvoca.app']));
  launched = true;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000);
  const screenshot = path.join(out, `${prefix}-online-first-screen.png`);
  run(['simctl', 'io', device.udid, 'screenshot', screenshot]);
  const png = fs.readFileSync(screenshot);
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('Simulator did not produce a PNG');
  metadata.screenshotPixels = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  write('device.json', metadata);
  if (family === 'iphone' && /iPhone (16|17) Pro Max/.test(device.name) &&
      (metadata.screenshotPixels.width !== 1320 || metadata.screenshotPixels.height !== 2868)) {
    throw Error(`Expected 1320x2868 Pro Max portrait screenshot, got ${JSON.stringify(metadata.screenshotPixels)}`);
  }
} finally {
  if (launched) run(['simctl', 'terminate', device.udid, 'com.orunvoca.app']);
}
console.log(`${prefix} public prelaunch screenshot captured and app terminated; XCTest is a separate CI step.`);

}
