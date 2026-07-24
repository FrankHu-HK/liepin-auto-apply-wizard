// tests/test_evalResult.js
// 覆盖四态结果判定：成功/已投过/失败(401/岗位关闭)/未知/空返回/error对象
const assert = require('assert');
const { evalResult } = require('../scripts/apply_pipeline.js');

function runTests() {
  let passed = 0, failed = 0, errors = [];
  function test(label, fn) {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e.message}`); }
  }

  const makeText = (obj) => ({ result: { content: [{ text: JSON.stringify(obj) }] } });

  test('应聘成功 → success', () => {
    const r = evalResult(makeText({ errCode: 0, message: '应聘成功' }));
    assert.strictEqual(r.status, 'success');
  });
  test('已投递过 → already', () => {
    const r = evalResult(makeText({ errCode: 1, message: '您已投递过该职位' }));
    assert.strictEqual(r.status, 'already');
  });
  test('401 unauthorized → fail', () => {
    const r = evalResult(makeText({ errCode: 401, message: 'unauthorized' }));
    assert.strictEqual(r.status, 'fail');
  });
  test('岗位已关闭 → fail', () => {
    const r = evalResult(makeText({ errCode: 500, message: '该职位已关闭，无法投递' }));
    assert.strictEqual(r.status, 'fail');
  });
  test('空返回 → unknown', () => {
    const r = evalResult({ result: { content: [] } });
    assert.strictEqual(r.status, 'unknown');
  });
  test('error对象 → fail', () => {
    const r = evalResult({ error: { message: 'unauthorized' } });
    assert.strictEqual(r.status, 'fail');
  });
  test('不命中任何关键词 → unknown', () => {
    const r = evalResult(makeText({ message: '一个未知状态' }));
    assert.strictEqual(r.status, 'unknown');
  });
  test('成功英文 → success', () => {
    const r = evalResult(makeText({ message: 'success' }));
    assert.strictEqual(r.status, 'success');
  });

  console.log(`[test_evalResult] passed=${passed} failed=${failed}`);
  if (errors.length) console.error(errors.join('\n'));
  return { passed, failed, errors };
}

if (require.main === module) runTests();
module.exports = { runTests };
