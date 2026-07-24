// tests/test_isRecruiterJob.js
// ：//JD 
const assert = require('assert');
const { isRecruiterJob } = require('../scripts/apply_pipeline.js');

function runTests() {
  let passed = 0, failed = 0, errors = [];
  function test(label, fn) {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e.message}`); }
  }

  test('（） → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '', company: '', jobDetail: '' }), true);
  });
  test('（） → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '', company: '', jobDetail: '' }), true);
  });
  test('（） → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '', company: '', jobDetail: '' }), true);
  });
  test('（） → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '', company: '', jobDetail: '' }), true);
  });
  test('JD  → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '', company: '', jobDetail: '' }), true);
  });
  test('JD  → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '', company: '', jobDetail: '' }), true);
  });
  test(' → false', () => {
    assert.strictEqual(isRecruiterJob({ industry: '', company: '', jobDetail: '' }), false);
  });
  test(' → false', () => {
    assert.strictEqual(isRecruiterJob({ industry: '', company: '', jobDetail: '' }), false);
  });

  console.log(`[test_isRecruiterJob] passed=${passed} failed=${failed}`);
  if (errors.length) console.error(errors.join('\n'));
  return { passed, failed, errors };
}

if (require.main === module) runTests();
module.exports = { runTests };
