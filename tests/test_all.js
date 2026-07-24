// tests/test_all.js
// 一键运行全部单元测试，零外部依赖
const tests = [
  require('./test_salaryParser'),
  require('./test_evalResult'),
  require('./test_rateLimit'),
  require('./test_isRecruiterJob'),
  require('./test_loadDelivered'),
  require('./test_loadQuota'),
  require('./test_normalize'),
];

let totalPassed = 0, totalFailed = 0, allErrors = [];
for (const t of tests) {
  const r = t.runTests();
  totalPassed += r.passed;
  totalFailed += r.failed;
  if (r.errors) allErrors.push(...r.errors);
}

console.log('\n========== 猎聘投递技能 单元测试汇总 ==========');
console.log(`通过：${totalPassed}    失败：${totalFailed}`);
if (totalFailed) {
  console.error('\n失败详情：');
  console.error(allErrors.join('\n'));
  process.exit(1);
}
console.log('全部通过，质量门禁 OK。');
