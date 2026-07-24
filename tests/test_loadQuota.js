// tests/test_loadQuota.js
// 覆盖每日配额：读今日/跨日重置/文件缺失
// 说明：apply_pipeline.js 在模块加载时固化 WORKDIR，故这里改用显式传入临时目录，
// 不依赖 process.chdir，避免测试污染项目目录也更稳定。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadQuota } = require('../scripts/apply_pipeline.js');

function runTests() {
  let passed = 0, failed = 0, errors = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-test-quota-'));
  const today = new Date().toISOString().slice(0, 10);
  function test(label, fn) {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e.message}`); }
  }

  test('无文件时返回今日 0 条', () => {
    const q = loadQuota(tmp);
    assert.strictEqual(q.date, today);
    assert.strictEqual(q.count, 0);
  });
  test('读今日配额', () => {
    fs.writeFileSync(path.join(tmp, 'liepin_daily_quota.json'), JSON.stringify({ date: today, count: 7 }));
    const q = loadQuota(tmp);
    assert.strictEqual(q.date, today);
    assert.strictEqual(q.count, 7);
  });
  test('跨日自动重置为 0', () => {
    fs.writeFileSync(path.join(tmp, 'liepin_daily_quota.json'), JSON.stringify({ date: '2020-01-01', count: 99 }));
    const q = loadQuota(tmp);
    assert.strictEqual(q.date, today);
    assert.strictEqual(q.count, 0);
  });
  test('文件损坏时返回今日 0 条', () => {
    fs.writeFileSync(path.join(tmp, 'liepin_daily_quota.json'), 'not-json');
    const q = loadQuota(tmp);
    assert.strictEqual(q.date, today);
    assert.strictEqual(q.count, 0);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`[test_loadQuota] passed=${passed} failed=${failed}`);
  if (errors.length) console.error(errors.join('\n'));
  return { passed, failed, errors };
}

if (require.main === module) runTests();
module.exports = { runTests };
