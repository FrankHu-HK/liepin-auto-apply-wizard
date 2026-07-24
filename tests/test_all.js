// tests/test_all.js

// ,

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



console.log('\n==========   ==========');

console.log(`:${totalPassed}    :${totalFailed}`);

if (totalFailed) {

  console.error('\n:');

  console.error(allErrors.join('\n'));

  process.exit(1);

}

console.log(', OK.');

