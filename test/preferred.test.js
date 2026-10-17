'use strict';
// Rank table "preferred" block (v1.3.2, = opencode-auto v1.4): pin after the gate, fallback_on_error, opencode --variant.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const W = require('../lib/workers');
const M = require('../lib/models');
const { sandbox, crew, calls } = require('./helpers');

// Pool from a fresh cache (not CREW_<W>_FREE_MODELS: that is a hand-written list and is never re-ordered). c is below the gate.
function pooled(preferred, extra = {}, n = 'opencode') {
  const sb = sandbox({ [`CREW_${n.toUpperCase()}_FREE_MODELS`]: '', ...extra });
  const st = path.join(sb.env.CREW_HOME, 'state'); const cfg = path.join(sb.env.CREW_HOME, 'config');
  fs.mkdirSync(st, { recursive: true }); fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(st, `${n}-free-models.json`), JSON.stringify({ fetched_at: Date.now(), models: [`${n}/a`, `${n}/b`, `${n}/c`] }));
  fs.writeFileSync(path.join(cfg, `${n}-model-rank.json`), JSON.stringify({ preferred, models: { [`${n}/a`]: { score: 80 }, [`${n}/b`]: { score: 70 }, [`${n}/c`]: { score: 30 } } }));
  return sb;
}
const models = (sb) => calls(sb).map((c) => c.argv[c.argv.indexOf('-m') + 1]);
const readLog = (sb, f) => { try { return fs.readFileSync(path.join(sb.env.CREW_HOME, 'logs', f), 'utf8'); } catch (_) { return ''; } };

test('preferredOf: builtin opencode block; a user block replaces it as a whole', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-')); process.env.CREW_CONFIG_DIR = dir;
  assert.strictEqual(M.preferredOf(W.WORKERS.opencode).order[0], 'opencode/deepseek-v4.1-flash-free');
  assert.deepStrictEqual(M.preferredOf(W.WORKERS.kilo), {});
  fs.writeFileSync(path.join(dir, 'opencode-model-rank.json'), JSON.stringify({ preferred: { order: ['opencode/x'] } }));
  assert.deepStrictEqual(M.preferredOf(W.WORKERS.opencode), { order: ['opencode/x'] });
  assert.ok(M.rankTable(W.WORKERS.opencode)['opencode/glm-5.3-flash-free'], 'models still merged from the builtin table');
  delete process.env.CREW_CONFIG_DIR;
});
test('preferred.order pins a gate-passed model to the front', () => {
  const sb = pooled({ order: ['opencode/b'] });
  const r = crew(['run', 'opencode', 'hi'], sb); assert.strictEqual(r.rc, 0, r.err);
  assert.deepStrictEqual(models(sb), ['opencode/b']); assert.match(readLog(sb, 'opencode.log'), /preferred_pin=opencode\/b/);
});
test('preferred.order: gate-excluded / not-in-pool models are never pinned; env pool and --model are left alone', () => {
  const sb = pooled({ order: ['opencode/c', 'opencode/zz'] });
  assert.strictEqual(crew(['run', 'opencode', 'hi'], sb).rc, 0); assert.deepStrictEqual(models(sb), ['opencode/a']);
  assert.doesNotMatch(readLog(sb, 'opencode.log'), /preferred_pin/);
  const sb2 = pooled({ order: ['opencode/b'] }, { CREW_OPENCODE_FREE_MODELS: 'opencode/a,opencode/b' });
  crew(['run', 'opencode', 'hi'], sb2); assert.deepStrictEqual(models(sb2), ['opencode/a']);
  const sb3 = pooled({ order: ['opencode/b'] });
  crew(['run', 'opencode', '--model', 'opencode/a', 'hi'], sb3); assert.deepStrictEqual(models(sb3), ['opencode/a']);
});
test('fallback_on_error: any error on that model switches to the next one (reason pinned_error)', () => {
  const sb = pooled({ order: ['opencode/b'], fallback_on_error: ['opencode/b'] }, { FAKE_BEHAVIOR: 'opencode/b=fail' });
  const r = crew(['run', 'opencode', 'hi'], sb); assert.strictEqual(r.rc, 0, r.err);
  assert.deepStrictEqual(models(sb), ['opencode/b', 'opencode/a']);
  assert.match(readLog(sb, 'opencode.log'), /pinned_error model=opencode\/b rc=2/);
  const ev = readLog(sb, 'events.jsonl').trim().split('\n').map(JSON.parse);
  assert.ok(ev.some((e) => e.event === 'switch' && e.reason === 'pinned_error' && e.model === 'opencode/a'));
  const sb2 = pooled({ order: ['opencode/b'] }, { FAKE_BEHAVIOR: 'opencode/b=fail' }); // not listed: the CLI's rc is returned as before
  assert.strictEqual(crew(['run', 'opencode', 'hi'], sb2).rc, 2); assert.deepStrictEqual(models(sb2), ['opencode/b']);
  const sb3 = pooled({ fallback_on_error: ['opencode/b'] }, { FAKE_BEHAVIOR: 'opencode/b=fail' }); // explicit --model: no fallback
  assert.strictEqual(crew(['run', 'opencode', '--model', 'opencode/b', 'hi'], sb3).rc, 2); assert.deepStrictEqual(models(sb3), ['opencode/b']);
  const sb4 = pooled({ fallback_on_error: ['opencode/a', 'opencode/b'] }, { FAKE_BEHAVIOR: '*=fail' }); // every model errors, none hit a quota
  assert.strictEqual(crew(['run', 'opencode', 'hi'], sb4).rc, 2); assert.deepStrictEqual(models(sb4), ['opencode/a', 'opencode/b']);
});
test('variant: opencode argv gets --variant <v> (bad values dropped); other workers never do', () => {
  const sb = pooled({ order: ['opencode/b'], variant: { 'opencode/b': 'max', 'opencode/a': 'x; rm -rf' } }, { FAKE_BEHAVIOR: 'opencode/b=limit' });
  assert.strictEqual(crew(['run', 'opencode', 'hi'], sb).rc, 0);
  const [b, a] = calls(sb).map((c) => c.argv);
  assert.deepStrictEqual(b.slice(b.indexOf('-m'), -1), ['-m', 'opencode/b', '--variant', 'max']); assert.match(b.at(-1), /hi$/);
  assert.ok(!a.includes('--variant'));
  const k = pooled({ variant: { 'kilo/a': 'max' } }, {}, 'kilo');
  crew(['run', 'kilo', 'hi'], k); assert.ok(!calls(k)[0].argv.includes('--variant'));
});
test('variant in exec mode: appended once; a user --variant is never duplicated', () => {
  const sb = pooled({ variant: { 'opencode/a': 'max' } });
  assert.strictEqual(crew(['exec', 'opencode', 'run', 'x'], sb).rc, 0);
  assert.deepStrictEqual(calls(sb)[0].argv, ['run', 'x', '-m', 'opencode/a', '--variant', 'max']);
  crew(['exec', 'opencode', 'run', '--variant', 'high', 'x'], sb);
  assert.deepStrictEqual(calls(sb)[1].argv, ['run', '--variant', 'high', 'x', '-m', 'opencode/a']);
  crew(['exec', 'opencode', 'run', '--variant=low', 'x'], sb);
  assert.strictEqual(calls(sb)[2].argv.filter((s) => s.startsWith('--variant')).length, 1);
});
test('v1.3.3: with --model the preferred pin still applies after it (= opencode-auto v1.4)', () => {
  const sb = pooled({ order: ['opencode/b'] }, { FAKE_BEHAVIOR: 'opencode/c=limit,opencode/b=limit' });
  crew(['run', 'opencode', '--model', 'opencode/c', 'hi'], sb);
  assert.deepStrictEqual(models(sb), ['opencode/c', 'opencode/b', 'opencode/a']);
  assert.match(readLog(sb, 'opencode.log'), /preferred_pin=opencode\/b/);
});
test('v1.3.3: offline builtin lists pass the gate with the builtin tables; opencode starts with preferred.order[0]', async () => {
  const G = require('../lib/gate');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-'));
  const keep = { ...process.env }; Object.assign(process.env, { CREW_CONFIG_DIR: path.join(dir, 'c'), CREW_STATE_DIR: path.join(dir, 's'), MODEL_BENCH_OFFLINE: '1', CREW_OPENCODE_FREE_MODELS: '', MODEL_REGION_BLOCK_FILE: path.join(dir, 'r.json') });
  try {
    for (const n of ['cline', 'kilo', 'opencode']) {
      const w = W.WORKERS[n]; const g = G.apply(w.builtin, M.rankTable(w), {}, { fb: {} });
      assert.deepStrictEqual(g.excluded.map((d) => d.model), [], n + ' builtin all pass'); assert.deepStrictEqual(g.provisional, [], n + ' no provisional');
    }
    const pl = await M.plan(W.WORKERS.opencode, { offline: true });
    assert.strictEqual(pl.src, 'builtin'); assert.strictEqual(pl.avail[0], M.preferredOf(W.WORKERS.opencode).order[0]);
    assert.ok(pl.pinned.length >= 1);
  } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
});
