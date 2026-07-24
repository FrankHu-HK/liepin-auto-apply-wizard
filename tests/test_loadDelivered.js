// tests/test_loadDelivered.js
// 覆盖跨会话去重：合并历史报告，仅成功/已投过计入已投集合
// 说明：apply_pipeline.js 在模块加载时固化 WORKDIR，故这里改用显式传入临时目录，
// 不依赖 process.chdir，避免测试污染项目目录也更稳定。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadDelivered } = require('../scripts/apply_pipeline.js');

function runTests() {
  let passed = 0, failed = 0, errors = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-test-delivered-'));
  function test(label, fn) {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e.message}`); }
  }

  fs.writeFileSync(path.join(tmp, 'liepin_wizard_report.json'), JSON.stringify({
    results: [
      { jobId: 1001, status: 'success' },
      { jobId: 1002, status: 'already' },
      { jobId: 1003, status: 'fail' },
      { jobId: 1004, status: 'unknown' },
    ]
  }));

  test('成功和已投过加入去重集合', () => {
    const set = loadDelivered(tmp);
    assert.strictEqual(set.has(1001), true);
    assert.strictEqual(set.has(1002), true);
  });
  test('失败和未知不加入去重集合', () => {
    const set = loadDelivered(tmp);
    assert.strictEqual(set.has(1003), false);
    assert.strictEqual(set.has(1004), false);
  });
  test('支持旧格式 items', () => {
    fs.writeFileSync(path.join(tmp, 'liepin_apply_report.json'), JSON.stringify({
      items: [{ jobId: 2001, status: 'success' }, { jobId: 2002, status: 'already' }]
    }));
    const set = loadDelivered(tmp);
    assert.strictEqual(set.has(2001), true);
    assert.strictEqual(set.has(2002), true);
  });
  test('文件损坏不抛异常，返回已读数据', () => {
    fs.writeFileSync(path.join(tmp, 'liepin_apply_report_deep.json'), 'not json');
    const set = loadDelivered(tmp);
    assert.strictEqual(set.has(1001), true);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`[test_loadDelivered] passed=${passed} failed=${failed}`);
  if (errors.length) console.error(errors.join('\n'));
  return { passed, failed, errors };
}

if (require.main === module) runTests();
module.exports = { runTests };
