// tests/test_isRecruiterJob.js
// 覆盖猎头识别启发式：行业/公司品牌库/JD 关键词
const assert = require('assert');
const { isRecruiterJob } = require('../scripts/apply_pipeline.js');

function runTests() {
  let passed = 0, failed = 0, errors = [];
  function test(label, fn) {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e.message}`); }
  }

  test('猎头行业（人力资源服务） → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '人力资源服务', company: '某某科技', jobDetail: '招聘' }), true);
  });
  test('猎头行业（劳务派遣） → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '互联网', company: '劳务派遣公司', jobDetail: '招聘' }), true);
  });
  test('猎头品牌库（科锐） → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '互联网', company: '科锐国际', jobDetail: '招聘' }), true);
  });
  test('猎头品牌库（锐仕方达） → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '金融', company: '锐仕方达', jobDetail: '招聘' }), true);
  });
  test('JD 含猎头代招 → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '互联网', company: '某某', jobDetail: '本岗位为猎头代招' }), true);
  });
  test('JD 含劳务派遣 → true', () => {
    assert.strictEqual(isRecruiterJob({ industry: '互联网', company: '某某', jobDetail: '本岗位为劳务派遣' }), true);
  });
  test('普通企业直招 → false', () => {
    assert.strictEqual(isRecruiterJob({ industry: '互联网', company: '某某科技', jobDetail: '负责产品规划' }), false);
  });
  test('制造业直招 → false', () => {
    assert.strictEqual(isRecruiterJob({ industry: '新能源', company: '某电池厂', jobDetail: '负责工艺' }), false);
  });

  console.log(`[test_isRecruiterJob] passed=${passed} failed=${failed}`);
  if (errors.length) console.error(errors.join('\n'));
  return { passed, failed, errors };
}

if (require.main === module) runTests();
module.exports = { runTests };
