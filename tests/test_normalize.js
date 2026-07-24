// tests/test_normalize.js
// ：（/、、、）、「」、
const assert = require('assert');
const { splitKeywords, normalizeLocation, normalizeMulti } = require('../scripts/apply_pipeline.js');

function runTests() {
  let passed = 0, failed = 0, errors = [];
  function test(label, fn) {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e.message}`); }
  }

  // ---- splitKeywords ----
  test(' → ', () => {
    const r = splitKeywords('，，HRBP，');
    assert.deepStrictEqual(r, ['', '', 'HRBP', '']);
  });
  test(' → ', () => {
    const r = splitKeywords(',,HRBP');
    assert.deepStrictEqual(r, ['', '', 'HRBP']);
  });
  test(' +  → ', () => {
    const r = splitKeywords('  、  、 ');
    assert.deepStrictEqual(r, ['', '', '']);
  });
  test(' → （）', () => {
    const r = splitKeywords(['', '', 'HRBP']);
    assert.deepStrictEqual(r, ['', 'HRBP']);
  });
  test('（） → ', () => {
    const r = splitKeywords('HRBP');
    assert.deepStrictEqual(r, ['HRBP']);
  });
  test(' → ', () => {
    assert.deepStrictEqual(splitKeywords(''), []);
    assert.deepStrictEqual(splitKeywords(undefined), []);
  });

  // ---- normalizeLocation ----
  test('「」 → __ALL__', () => { assert.strictEqual(normalizeLocation(''), '__ALL__'); });
  test(' → __ALL__', () => { assert.strictEqual(normalizeLocation(''), '__ALL__'); });
  test('undefined → __ALL__', () => { assert.strictEqual(normalizeLocation(undefined), '__ALL__'); });
  test('__ALL__ → __ALL__', () => { assert.strictEqual(normalizeLocation('__ALL__'), '__ALL__'); });
  test(' → ', () => { assert.strictEqual(normalizeLocation(''), ''); });
  test(' → ', () => { assert.strictEqual(normalizeLocation('    '), ''); });

  // ---- normalizeMulti ----
  test('「」→ __ALL__', () => { assert.deepStrictEqual(normalizeMulti(''), ['__ALL__']); });
  test(' → ', () => { assert.deepStrictEqual(normalizeMulti('，'), ['', '']); });
  test(' __ALL__ → __ALL__', () => { assert.deepStrictEqual(normalizeMulti(['__ALL__', '']), ['__ALL__']); });
  test(' → ', () => { assert.deepStrictEqual(normalizeMulti(['', '']), ['', '']); });
  test(' undefined → __ALL__', () => { assert.deepStrictEqual(normalizeMulti(undefined), ['__ALL__']); });

  console.log(`[test_normalize] passed=${passed} failed=${failed}`);
  if (errors.length) console.error(errors.join('\n'));
  return { passed, failed, errors };
}

if (require.main === module) runTests();
module.exports = { runTests };
