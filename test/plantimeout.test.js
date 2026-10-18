'use strict';
// v1.3.5 timeout-hardening: a hung planner is capped (CREW_PLAN_TIMEOUT, default 30 s) and falls into the builtin fallback;
// judgement calls still pass the judgement gate after the fallback (never a weak model).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const G = require('../lib/gate');
const M = require('../lib/models');
const W = require('../lib/workers');
const { sandbox, crew, calls } = require('./helpers');

const HANG = path.join(__dirname, 'fixtures', 'hang-plan.js');
const hung = (extra = {}) => sandbox({ NODE_OPTIONS: `--require ${HANG}`, CREW_PLAN_TIMEOUT: '1', MODEL_MIN_SCORE: '0', ...extra });
const models = (s) => calls(s).map((c) => c.argv[c.argv.indexOf('-m') + 1]);
const builtin = () => W.getWorker('opencode').builtin;

test('hung planner: normal call falls back to the builtin list after the cap', () => {
  const s = hung({ AGENT_CALLER: 'fac-build' }); const t0 = Date.now();
  const r = crew(['run', 'opencode', 'hi'], s); const el = Date.now() - t0;
  assert.strictEqual(r.rc, 0, r.err); assert.ok(el >= 900 && el < 20000, `elapsed ${el}`);
  assert.deepStrictEqual(models(s), [builtin()[0]]);
});
test('hung planner: judgement call still runs only production-grade builtin models', () => {
  const s = hung({ AGENT_CALLER: 'x-review' });
  const r = crew(['run', 'opencode', 'hi'], s); const used = models(s);
  const jt = M.judgeTable(); const prod = new Set(G.judgeGrade(builtin(), jt.table, jt.min).filter((g) => g.grade === 'prod').map((g) => g.model));
  if (prod.size) { assert.strictEqual(r.rc, 0, r.err); assert.ok(used.length && used.every((m) => prod.has(m)), used.join(',')); }
  else { assert.strictEqual(r.rc, 78); assert.deepStrictEqual(used, []); }
});
