'use strict';
// Capability gate (v1.1.0): exclusion, provisional ordering, bench fetch failure fallback, feedback, 75 + --model bypass.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const G = require('../lib/gate');
const { sandbox, crew, calls } = require('./helpers');

const TABLE = { 'k/strong': { score: 80 }, 'k/mid': { score: 66 }, 'k/weak': { score: 40 }, 'k/badtb': { score: 70, tb: 5 }, 'k/vend': { score: 55, evidence: 'vendor' } };
const POOL = ['k/weak', 'k/newbie', 'k/badtb', 'k/mid', 'k/tiny-nano', 'k/strong'];

test('gate: below-baseline + agentic-floor failures excluded; unrated models provisional after every rated one', () => {
  const g = G.apply(POOL, TABLE, {}, { fb: {} });
  assert.deepStrictEqual(g.eligible, ['k/strong', 'k/mid', 'k/newbie']);
  assert.deepStrictEqual(g.excluded.map((d) => d.model).sort(), ['k/badtb', 'k/tiny-nano', 'k/weak']);
  assert.match(G.humanExcluded(g.excluded), /MODEL_MIN_SCORE=60/);
});
test('gate: MODEL_MIN_SCORE=0 relaxes, MODEL_PROVISIONAL=0 drops unrated', () => {
  process.env.MODEL_MIN_SCORE = '0';
  assert.deepStrictEqual(G.apply(POOL, TABLE, {}, { fb: {} }).excluded, []);
  delete process.env.MODEL_MIN_SCORE; process.env.MODEL_PROVISIONAL = '0';
  assert.deepStrictEqual(G.apply(POOL, TABLE, {}, { fb: {} }).eligible, ['k/strong', 'k/mid']);
  delete process.env.MODEL_PROVISIONAL;
});
test('gate: live AA via OpenRouter, family premium capped, proxy tier, feedback promote/demote', () => {
  const bm = G.parseOpenRouter({ data: [{ id: 'acme/benchy', benchmarks: { artificial_analysis: { intelligence_index: 45, agentic_index: 40 } } },
    { id: 'acme/fam-2', benchmarks: { artificial_analysis: { intelligence_index: 35 } } }, { id: 'acme/top-1.3', benchmarks: { artificial_analysis: { intelligence_index: 48 } } }] });
  const g = G.apply(['k/benchy', 'k/fam-3', 'k/top-1.3-contributor', 'k/newbie', 'k/flop'], {}, bm,
    { fb: { 'k/newbie': [5, 0], 'k/flop': [0, 6] } });
  const by = Object.fromEntries(g.results.map((d) => [d.model, d]));
  assert.strictEqual(by['k/benchy'].score, 90); assert.strictEqual(by['k/benchy'].status, 'pass');
  assert.strictEqual(by['k/fam-3'].score, 79); assert.strictEqual(by['k/fam-3'].status, 'provisional'); // 70 + capped 10, ceiling 79
  assert.strictEqual(by['k/top-1.3-contributor'].evidence, 'openrouter_aa_proxy');
  assert.strictEqual(by['k/newbie'].status, 'pass'); assert.strictEqual(by['k/newbie'].score, 60); // trial passed
  assert.strictEqual(by['k/flop'].status, 'excluded');
  assert.deepStrictEqual(g.eligible.slice(0, 3), ['k/top-1.3-contributor', 'k/benchy', 'k/newbie']); // proxy 91, measured 90, trial-passed 60, then provisional
});
test('gate: bench fetch failure -> stale cache -> none (never throws)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-')); process.env.CREW_STATE_DIR = d;
  const boom = async () => { throw new Error('fetch:timeout'); };
  let info = []; let b = await G.bench(boom, info); assert.strictEqual(b.src, 'none'); assert.ok(info[0].startsWith('bench_fetch_failed'));
  fs.writeFileSync(G.benchPath(), JSON.stringify({ fetched_at: 1, models: { benchy: { aa: 45 } } }));
  info = []; b = await G.bench(boom, info); assert.strictEqual(b.src, 'stale_cache'); assert.strictEqual(b.models.benchy.aa, 45);
  const ok = async () => ({ data: { data: [{ id: 'z/benchy', benchmarks: { artificial_analysis: { intelligence_index: 30 } } }] } });
  b = await G.bench(ok, []); assert.strictEqual(b.src, 'live'); b = await G.bench(boom, []); assert.strictEqual(b.src, 'cache');
  delete process.env.CREW_STATE_DIR;
});
function gated(extra) {
  const sb = sandbox(extra); const cfg = path.join(sb.env.CREW_HOME, 'config'); fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'kilo-model-rank.json'), JSON.stringify({ models: { 'kilo/a': { score: 30 }, 'kilo/b': { score: 45 }, 'kilo/c': { score: 80 } } }));
  return sb;
}
test('run: only eligible models rotate; all eligible exhausted -> 75 with gate reason; --model bypasses the gate', () => {
  const sb = gated({ FAKE_BEHAVIOR: 'kilo/c=limit' });
  const r = crew(['run', 'kilo', 'hi'], sb);
  assert.strictEqual(r.rc, 75); assert.match(r.err, /门槛/); assert.match(r.err, /MODEL_MIN_SCORE=0/);
  assert.deepStrictEqual(calls(sb).map((c) => c.argv.slice(-2, -1)[0]), ['kilo/c']);
  const r2 = crew(['run', 'kilo', 'hi'], sb); assert.strictEqual(r2.rc, 75); assert.match(r2.err, /门槛/);
  const r3 = crew(['run', 'kilo', '--model', 'kilo/a', 'hi'], sb); assert.strictEqual(r3.rc, 0, r3.err);
  assert.strictEqual(calls(sb).slice(-1)[0].argv.slice(-2, -1)[0], 'kilo/a');
  const r4 = crew(['run', 'kilo', 'hi'], sb, { env: { MODEL_MIN_SCORE: '0' } }); assert.strictEqual(r4.rc, 0, r4.err);
});
