const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/layout');
test('desktop fills below toolbar', () => {
  assert.deepStrictEqual(L.computeRemoteBounds('desktop', 1200, 800), { x: 0, y: 40, width: 1200, height: 760 });
});
test('phone is exactly 390 wide and centered', () => {
  assert.deepStrictEqual(L.computeRemoteBounds('phone', 1200, 800), { x: 405, y: 40, width: 390, height: 760 });
});
test('phone narrower window clamps; unknown mode -> desktop', () => {
  assert.strictEqual(L.computeRemoteBounds('phone', 300, 600).width, 300);
  assert.strictEqual(L.computeRemoteBounds('x', 1000, 600).width, 1000);
});
test('tablet is exactly 768 wide and centered, full available height', () => {
  assert.strictEqual(L.TABLET_WIDTH, 768);
  assert.strictEqual(L.PHONE_WIDTH, 390);
  assert.deepStrictEqual(L.computeRemoteBounds('tablet', 1200, 800), { x: 216, y: 40, width: 768, height: 760 });
  assert.deepStrictEqual(L.computeRemoteBounds('tablet', 1184, 761), { x: 208, y: 40, width: 768, height: 721 });
});
test('tablet 768 vs phone 390 vs desktop fill at the same window size', () => {
  for (const [w, h] of [[1184, 761], [1920, 1040], [800, 600], [769, 500]]) {
    const d = L.computeRemoteBounds('desktop', w, h), t = L.computeRemoteBounds('tablet', w, h), p = L.computeRemoteBounds('phone', w, h);
    assert.strictEqual(d.width, w); assert.strictEqual(t.width, 768); assert.strictEqual(p.width, 390);
    assert.ok(d.width > t.width && t.width > p.width);
    assert.strictEqual(d.height, h - 40); assert.strictEqual(t.height, h - 40); assert.strictEqual(p.height, h - 40);
    // Centered: equal margins (floor on odd remainders).
    for (const b of [t, p]) { assert.strictEqual(b.x, Math.floor((w - b.width) / 2)); assert.ok(w - (b.x + b.width) - b.x <= 1); }
  }
});
test('narrow windows clamp tablet (and phone) to the available width', () => {
  assert.deepStrictEqual(L.computeRemoteBounds('tablet', 768, 600), { x: 0, y: 40, width: 768, height: 560 });
  assert.deepStrictEqual(L.computeRemoteBounds('tablet', 767, 600), { x: 0, y: 40, width: 767, height: 560 });
  assert.deepStrictEqual(L.computeRemoteBounds('tablet', 404, 600), { x: 0, y: 40, width: 404, height: 560 }); // minWidth 420 window
  assert.deepStrictEqual(L.computeRemoteBounds('phone', 404, 600), { x: 7, y: 40, width: 390, height: 560 });
  assert.deepStrictEqual(L.computeRemoteBounds('tablet', 300, 600), { x: 0, y: 40, width: 300, height: 560 });
  assert.deepStrictEqual(L.computeRemoteBounds('tablet', 0, 0), { x: 0, y: 40, width: 0, height: 0 });
  assert.deepStrictEqual(L.computeRemoteBounds('tablet', -50, 20), { x: 0, y: 40, width: 0, height: 0 });
  assert.deepStrictEqual(L.computeRemoteBounds('tablet', 900.9, 600.7), { x: 66, y: 40, width: 768, height: 560 });
  assert.deepStrictEqual(L.computeRemoteBounds('tablet', NaN, NaN), { x: 0, y: 40, width: 0, height: 0 });
});
test('exact modes desktop/tablet/phone in user order; everything else is desktop', () => {
  assert.deepStrictEqual([...L.MODE_ORDER], ['desktop', 'tablet', 'phone']);
  assert.deepStrictEqual({ ...L.MODES }, { DESKTOP: 'desktop', TABLET: 'tablet', PHONE: 'phone' });
  assert.ok(Object.isFrozen(L.MODES) && Object.isFrozen(L.MODE_ORDER) && Object.isFrozen(L.MODE_WIDTHS));
  for (const m of L.MODE_ORDER) assert.strictEqual(L.normalizeMode(m), m);
  for (const m of ['Tablet', 'TABLET', ' tablet', 'tablet ', 'ipad', 'mobile', 'Phone', '', null, undefined, 768, {}, ['tablet'], 'constructor', '__proto__', 'toString'])
    assert.strictEqual(L.normalizeMode(m), 'desktop', String(m));
  assert.strictEqual(L.computeRemoteBounds('__proto__', 1000, 600).width, 1000);
  assert.strictEqual(L.computeRemoteBounds('constructor', 1000, 600).width, 1000);
});
test('3-way transitions are pure: bounds depend only on (mode, size), never on the previous mode', () => {
  const sizes = [[1184, 761], [700, 761], [404, 761]];
  for (const [w, h] of sizes) {
    const ref = Object.fromEntries(L.MODE_ORDER.map((m) => [m, L.computeRemoteBounds(m, w, h)]));
    for (const a of L.MODE_ORDER) for (const b of L.MODE_ORDER) {
      L.computeRemoteBounds(a, w, h);
      assert.deepStrictEqual(L.computeRemoteBounds(b, w, h), ref[b], `${a}->${b} at ${w}`);
    }
  }
});
test('toolbar spans the full content width above the remote view', () => {
  assert.deepStrictEqual(L.computeToolbarBounds(1184), { x: 0, y: 0, width: 1184, height: 40 });
  assert.deepStrictEqual(L.computeToolbarBounds(404), { x: 0, y: 0, width: 404, height: 40 });
  for (const m of L.MODE_ORDER) assert.strictEqual(L.computeRemoteBounds(m, 1184, 761).y, L.computeToolbarBounds(1184).height);
});
