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
