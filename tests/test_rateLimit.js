// tests/test_rateLimit.js
// 覆盖频控检测：429/频繁/rate limit/受限等关键词，以及正常返回
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
  test('频繁 → true', () => assert.strictEqual(isRateLimit(makeResp('请求过于频繁')), true));
  test('受限 → true', () => assert.strictEqual(isRateLimit(makeResp('访问受限')), true));
  test('rate limit 英文 → true', () => assert.strictEqual(isRateLimit(makeResp('rate limit')), true));
  test('error 字段频繁 → true', () => assert.strictEqual(isRateLimit({ error: { message: '429' } }), true));
  test('应聘成功 → false', () => assert.strictEqual(isRateLimit(makeResp('应聘成功')), false));
  test('空对象 → false', () => assert.strictEqual(isRateLimit({}), false));
  test('undefined → false', () => assert.strictEqual(isRateLimit(undefined), false));

  console.log(`[test_rateLimit] passed=${passed} failed=${failed}`);
  if (errors.length) console.error(errors.join('\n'));
  return { passed, failed, errors };
}

if (require.main === module) runTests();
module.exports = { runTests };
