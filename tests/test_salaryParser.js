// tests/test_salaryParser.js
// ：K////
const assert = require('assert');
const { parseSalary } = require('../scripts/apply_pipeline.js');

function runTests() {
  let passed = 0, failed = 0, errors = [];
  function test(label, fn) {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e.message}`); }
  }

  test('25-40k → floor=25 ceil=40', () => {
    const r = parseSalary('25-40k');
    assert.strictEqual(r.floor, 25); assert.strictEqual(r.ceil, 40);
  });
  test('15-30K（ K）→ floor=15 ceil=30', () => {
    const r = parseSalary('15-30K');
    assert.strictEqual(r.floor, 15); assert.strictEqual(r.ceil, 30);
  });
  test('30 → floor=300 ceil=300', () => {
    const r = parseSalary('30');
    assert.strictEqual(r.floor, 300); assert.strictEqual(r.ceil, 300);
  });
  test('//negotiable → null/null', () => {
    ['', '', 'Negotiable'].forEach((s) => {
      const r = parseSalary(s);
      assert.strictEqual(r.floor, null); assert.strictEqual(r.ceil, null);
    });
  });
  test('20k → floor=20 ceil=20', () => {
    const r = parseSalary('20k');
    assert.strictEqual(r.floor, 20); assert.strictEqual(r.ceil, 20);
  });
  test('/undefined → null/null', () => {
    assert.strictEqual(parseSalary('').floor, null);
    assert.strictEqual(parseSalary(undefined).floor, null);
  });
  test(' 18 → floor=18 ceil=18', () => {
    const r = parseSalary('18');
    assert.strictEqual(r.floor, 18); assert.strictEqual(r.ceil, 18);
  });
  test(' 12.5-20k → 12.5/20', () => {
    const r = parseSalary('12.5-20k');
    assert.strictEqual(r.floor, 12.5); assert.strictEqual(r.ceil, 20);
  });

  console.log(`[test_salaryParser] passed=${passed} failed=${failed}`);
  if (errors.length) console.error(errors.join('\n'));
  return { passed, failed, errors };
}

if (require.main === module) runTests();
module.exports = { runTests };
