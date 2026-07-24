// tests/test_rateLimit.js
// ：429//rate limit/，
const assert = require('assert');
const { isRateLimit } = require('../scripts/apply_pipeline.js');

function runTests() {
  let passed = 0, failed = 0, errors = [];
  function test(label, fn) {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e.message}`); }
  }

  const makeResp = (text) => ({ result: { content: [{ text }] } });

  test('429 → true', () => assert.strictEqual(isRateLimit(makeResp('429')), true));
  test(' → true', () => assert.strictEqual(isRateLimit(makeResp('')), true));
  test(' → true', () => assert.strictEqual(isRateLimit(makeResp('')), true));
  test('rate limit  → true', () => assert.strictEqual(isRateLimit(makeResp('rate limit')), true));
  test('error  → true', () => assert.strictEqual(isRateLimit({ error: { message: '429' } }), true));
  test(' → false', () => assert.strictEqual(isRateLimit(makeResp('')), false));
  test(' → false', () => assert.strictEqual(isRateLimit({}), false));
  test('undefined → false', () => assert.strictEqual(isRateLimit(undefined), false));

  console.log(`[test_rateLimit] passed=${passed} failed=${failed}`);
  if (errors.length) console.error(errors.join('\n'));
  return { passed, failed, errors };
}

if (require.main === module) runTests();
module.exports = { runTests };
