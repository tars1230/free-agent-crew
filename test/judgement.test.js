'use strict';
// v1.3.4 judgement gate: judgement calls (AUTO_JUDGEMENT=1 / AGENT_CALLER, AGENT_TASK, AGENT_ROLE with a review word /
// crew review) only run and only switch on production-grade models; none left -> 78. Other calls unchanged.
const test = require('node:test');
const assert = require('node:assert');
const G = require('../lib/gate');
const M = require('../lib/models');
const { sandbox, crew, calls } = require('./helpers');

const A = 'opencode/glm-5.3-flash-free'; const WK = 'opencode/big-pickle'; const B = 'opencode/step-5-preview-free';
const sb = (extra = {}) => sandbox({ CREW_OPENCODE_FREE_MODELS: `${A},${WK},${B}`, MODEL_MIN_SCORE: '0', ...extra });
const models = (s) => calls(s).map((c) => c.argv[c.argv.indexOf('-m') + 1]);

test('judgeWhy: env flag and review words in caller / task / role; plain callers are not judgement', () => {
  assert.strictEqual(G.judgeWhy({ AUTO_JUDGEMENT: '1' }), 'AUTO_JUDGEMENT=1');
  assert.strictEqual(G.judgeWhy({ AGENT_CALLER: 'fac133-review' }), 'caller=fac133-review');
  assert.strictEqual(G.judgeWhy({ AGENT_TASK: '复核 v1.3.4' }), 'AGENT_TASK');
  assert.strictEqual(G.judgeWhy({ AGENT_ROLE: 'supervision' }), 'AGENT_ROLE');
  assert.strictEqual(G.judgeWhy({ AGENT_CALLER: 'fac-build', AUTO_JUDGEMENT: '0' }), '');
});
test('judgeGrade: measured pass = prod; provisional / proxy = weak; unknown = unrated', () => {
  const jt = M.judgeTable();
  const g = Object.fromEntries(G.judgeGrade([A, WK, 'cline-free/muse-spark-1.3-contributor', 'zz/q'], jt.table, jt.min).map((x) => [x.model, x.grade]));
  assert.deepStrictEqual(g, { [A]: 'prod', [WK]: 'weak', 'cline-free/muse-spark-1.3-contributor': 'weak', 'zz/q': 'unrated' });
});
test('normal call still switches to the weak model; judgement call skips it', () => {
  const n = sb({ FAKE_BEHAVIOR: `${A}=limit`, AGENT_CALLER: 'fac-build' });
  assert.strictEqual(crew(['run', 'opencode', 'hi'], n).rc, 0); assert.deepStrictEqual(models(n), [A, WK]);
  for (const env of [{ AGENT_CALLER: 'fac133-review' }, { AUTO_JUDGEMENT: '1' }, { AGENT_TASK: '验收' }]) {
    const j = sb({ FAKE_BEHAVIOR: `${A}=limit`, ...env });
    assert.strictEqual(crew(['run', 'opencode', 'hi'], j).rc, 0); assert.deepStrictEqual(models(j), [A, B]);
  }
});
test('judgement call with only weak candidates fails with 78 and runs nothing; prod exhausted -> 75, never weak', () => {
  const j = sandbox({ CREW_OPENCODE_FREE_MODELS: WK, MODEL_MIN_SCORE: '0', AGENT_CALLER: 'x-review' });
  const r = crew(['run', 'opencode', 'hi'], j); assert.strictEqual(r.rc, 78); assert.deepStrictEqual(models(j), []); assert.match(r.err, /判断类调用/);
  const e = sandbox({ CREW_OPENCODE_FREE_MODELS: `${A},${WK}`, MODEL_MIN_SCORE: '0', AGENT_CALLER: 'x-review', FAKE_BEHAVIOR: `${A}=limit` });
  const r2 = crew(['run', 'opencode', 'hi'], e); assert.strictEqual(r2.rc, 75); assert.deepStrictEqual(models(e), [A]); assert.match(r2.err, /不退到弱模型/);
});
test('explicit --model weak: judgement drops it, normal call keeps it', () => {
  const j = sb({ AGENT_CALLER: 'x-review' }); crew(['run', 'opencode', '--model', WK, 'hi'], j); assert.deepStrictEqual(models(j), [A]);
  const n = sb({ AGENT_CALLER: 'x-build' }); crew(['run', 'opencode', '--model', WK, 'hi'], n); assert.deepStrictEqual(models(n), [WK]);
});
