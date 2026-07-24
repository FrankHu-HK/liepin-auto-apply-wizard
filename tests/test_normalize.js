// tests/test_normalize.js
// 覆盖输入归一化：关键词拆分（中/英文逗号、顿号、分号、空白）、地点「不限」归一、多选字段
const assert = require('assert');
const { splitKeywords, normalizeLocation, normalizeMulti } = require('../scripts/apply_pipeline.js');

function runTests() {
  let passed = 0, failed = 0, errors = [];
  function test(label, fn) {
    try { fn(); passed++; }
    catch (e) { failed++; errors.push(`${label}: ${e.message}`); }
  }

  // ---- splitKeywords ----
  test('中文逗号分隔 → 多个关键词', () => {
    const r = splitKeywords('人力资源，行政，HRBP，组织发展');
    assert.deepStrictEqual(r, ['人力资源', '行政', 'HRBP', '组织发展']);
  });
  test('英文逗号分隔 → 多个关键词', () => {
    const r = splitKeywords('产品经理,运营总监,HRBP');
    assert.deepStrictEqual(r, ['产品经理', '运营总监', 'HRBP']);
  });
  test('顿号 + 空白混合 → 拆分并去空白', () => {
    const r = splitKeywords(' 薪酬 、 绩效 、培训 ');
    assert.deepStrictEqual(r, ['薪酬', '绩效', '培训']);
  });
  test('已是数组 → 原样返回（去空）', () => {
    const r = splitKeywords(['产品总监', '', 'HRBP']);
    assert.deepStrictEqual(r, ['产品总监', 'HRBP']);
  });
  test('单关键词（无分隔符） → 单元素数组', () => {
    const r = splitKeywords('HRBP');
    assert.deepStrictEqual(r, ['HRBP']);
  });
  test('空串 → 空数组', () => {
    assert.deepStrictEqual(splitKeywords(''), []);
    assert.deepStrictEqual(splitKeywords(undefined), []);
  });

  // ---- normalizeLocation ----
  test('「不限」 → __ALL__', () => { assert.strictEqual(normalizeLocation('不限'), '__ALL__'); });
  test('空串 → __ALL__', () => { assert.strictEqual(normalizeLocation(''), '__ALL__'); });
  test('undefined → __ALL__', () => { assert.strictEqual(normalizeLocation(undefined), '__ALL__'); });
  test('__ALL__ → __ALL__', () => { assert.strictEqual(normalizeLocation('__ALL__'), '__ALL__'); });
  test('具体城市 → 原值', () => { assert.strictEqual(normalizeLocation('深圳'), '深圳'); });
  test('前后空白的城市 → 去空白', () => { assert.strictEqual(normalizeLocation('  杭州  '), '杭州'); });

  // ---- normalizeMulti ----
  test('行业字符串「不限」→ __ALL__', () => { assert.deepStrictEqual(normalizeMulti('不限'), ['__ALL__']); });
  test('行业字符串逗号分隔 → 数组', () => { assert.deepStrictEqual(normalizeMulti('互联网，金融'), ['互联网', '金融']); });
  test('行业数组含 __ALL__ → __ALL__', () => { assert.deepStrictEqual(normalizeMulti(['__ALL__', '互联网']), ['__ALL__']); });
  test('行业数组正常 → 原样', () => { assert.deepStrictEqual(normalizeMulti(['互联网', '金融']), ['互联网', '金融']); });
  test('行业 undefined → __ALL__', () => { assert.deepStrictEqual(normalizeMulti(undefined), ['__ALL__']); });

  console.log(`[test_normalize] passed=${passed} failed=${failed}`);
  if (errors.length) console.error(errors.join('\n'));
  return { passed, failed, errors };
}

if (require.main === module) runTests();
module.exports = { runTests };
