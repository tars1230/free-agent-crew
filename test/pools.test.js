'use strict';
// v1.3.7 (mirrors live delisted-pool): the built-in candidate pools carry no delisted model id, and every built-in id is
// production-grade under the bundled rank tables (so an offline / planner-failed run can never land on a weak or gone model).
const test = require('node:test');
const assert = require('node:assert');
const { WORKERS } = require('../lib/workers');
const G = require('../lib/gate');
const M = require('../lib/models');

// Checked 2026-10-18 against opencode Zen /models + `opencode models opencode`, cline recommended-models API,
// kilo gateway /models + `kilo models kilo`: these ids are no longer listed.
const DELISTED = ['opencode/step-5-preview-free', 'cline-free/step-5-preview', 'kilo/stepfun/step-5-preview-free'];

test('built-in pools contain no delisted model id', () => {
  for (const [name, w] of Object.entries(WORKERS)) {
    for (const id of w.builtin || []) assert.ok(!DELISTED.includes(id), `${name} builtin still lists delisted ${id}`);
    assert.ok(!(w.builtin || []).some((id) => /step-5-preview/.test(id)), `${name} builtin mentions step-5-preview`);
  }
});
test('every built-in pool id is production-grade (kilo has none on 2026-10-18 -> empty)', () => {
  const jt = M.judgeTable();
  for (const [name, w] of Object.entries(WORKERS)) {
    const g = G.judgeGrade(w.builtin || [], jt.table, jt.min);
    for (const x of g) assert.strictEqual(x.grade, 'prod', `${name} builtin ${x.model} is ${x.grade}`);
  }
  assert.deepStrictEqual(WORKERS.kilo.builtin, []);
});
