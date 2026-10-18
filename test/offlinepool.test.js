'use strict';
// v1.3.8 (mirrors live builtin-gate): when the live model list cannot be fetched (no env override, no cache), the run uses
// the built-in pool, and a normal call must never start on a weak or paid model: kilo has no free production-grade model
// -> exit 75 with zero calls; cline runs mimo only; opencode starts on its first production-grade model, never a weak one.
const test = require('node:test');
const assert = require('node:assert');
const W = require('../lib/workers');
const { sandbox, crew, calls } = require('./helpers');

const WEAK = /big-pickle|nemotron|muse-spark|solar-mini|ling-3\.1|longcat|space-bunny/;
const off = (extra = {}) => sandbox({ AGENT_CALLER: 'fac-build', MODEL_MIN_SCORE: '0',
  CREW_OPENCODE_FREE_MODELS: '', CREW_CLINE_FREE_MODELS: '', CREW_KILO_FREE_MODELS: '',
  CREW_OPENCODE_URL: 'http://127.0.0.1:9/m', CREW_CLINE_URL: 'http://127.0.0.1:9/m', CREW_KILO_URL: 'http://127.0.0.1:9/m', ...extra });
const models = (s) => calls(s).map((c) => c.argv[c.argv.indexOf('-m') + 1]);

test('offline pool: kilo has no free production-grade built-in model -> 75, zero calls (never a paid model)', () => {
  const s = off(); const r = crew(['run', 'kilo', 'hi'], s);
  assert.strictEqual(r.rc, 75, r.err); assert.deepStrictEqual(calls(s), []);
});
test('offline pool: cline runs mimo, never muse-spark first', () => {
  const s = off(); const r = crew(['run', 'cline', 'hi'], s);
  assert.strictEqual(r.rc, 0, r.err); assert.deepStrictEqual(models(s), ['cline-free/mimo-v2.6-flash']);
});
test('offline pool: opencode starts on its first production-grade built-in model, no weak model called', () => {
  const s = off(); const r = crew(['run', 'opencode', 'hi'], s); const used = models(s);
  assert.strictEqual(r.rc, 0, r.err); assert.strictEqual(used[0], W.getWorker('opencode').builtin[0]);
  assert.ok(!used.some((m) => WEAK.test(m)), used.join(','));
});
