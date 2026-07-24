// tests/test_evalResult.js

// ://(401/)///error

const assert = require('assert');

const { evalResult } = require('../scripts/apply_pipeline.js');



function runTests() {

  let passed = 0, failed = 0, errors = [];

  function test(label, fn) {

    try { fn(); passed++; }

    catch (e) { failed++; errors.push(`${label}: ${e.message}`); }

  }



  const makeText = (obj) => ({ result: { content: [{ text: JSON.stringify(obj) }] } });



  test(' → success', () => {

    const r = evalResult(makeText({ errCode: 0, message: '' }));

    assert.strictEqual(r.status, 'success');

  });

  test(' → already', () => {

    const r = evalResult(makeText({ errCode: 1, message: '' }));

    assert.strictEqual(r.status, 'already');

  });

  test('401 unauthorized → fail', () => {

    const r = evalResult(makeText({ errCode: 401, message: 'unauthorized' }));

    assert.strictEqual(r.status, 'fail');

  });

  test(' → fail', () => {

    const r = evalResult(makeText({ errCode: 500, message: ',' }));

    assert.strictEqual(r.status, 'fail');

  });

  test(' → unknown', () => {

    const r = evalResult({ result: { content: [] } });

    assert.strictEqual(r.status, 'unknown');

  });

  test('error → fail', () => {

    const r = evalResult({ error: { message: 'unauthorized' } });

    assert.strictEqual(r.status, 'fail');

  });

  test(' → unknown', () => {

    const r = evalResult(makeText({ message: '' }));

    assert.strictEqual(r.status, 'unknown');

  });

  test(' → success', () => {

    const r = evalResult(makeText({ message: 'success' }));

    assert.strictEqual(r.status, 'success');

  });



  console.log(`[test_evalResult] passed=${passed} failed=${failed}`);

  if (errors.length) console.error(errors.join('\n'));

  return { passed, failed, errors };

}



if (require.main === module) runTests();

module.exports = { runTests };

