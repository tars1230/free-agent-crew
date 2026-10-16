'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process');
const W = require('../lib/workers');
const M = require('../lib/models');

test('heuristic: unknown flagship > mini/flash/nano; family + size count', () => {
  const h = M.heuristic;
  assert.ok(h('opencode/deepseek-v5-pro-free') > h('opencode/deepseek-v5-flash-free'));
  assert.ok(h('kilo/x/foo-ultra-550b:free') > h('kilo/x/foo-nano-8b:free'));
  assert.ok(h('kilo/stepfun/step-9-free') > h('kilo/google/gemma-9-free'));
});
test('rank: table first, new models join by heuristic, bad score tolerated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-')); process.env.CREW_CONFIG_DIR = dir;
  fs.writeFileSync(path.join(dir, 'kilo-model-rank.json'), JSON.stringify({ models: { 'kilo/a': { score: 'oops' }, 'kilo/b': { score: 99 } } }));
  const info = [];
  const r = M.rankModels(W.WORKERS.kilo, ['kilo/a', 'kilo/zz-nano', 'kilo/b', 'kilo/new-pro-model'], { info });
  assert.strictEqual(r[0], 'kilo/b');
  assert.ok(r.indexOf('kilo/new-pro-model') < r.indexOf('kilo/zz-nano'));
  assert.ok(info.some((i) => i.startsWith('rank_bad_score model=kilo/a')));
  delete process.env.CREW_CONFIG_DIR;
});
test('parseReset: past ISO (log ts) ignored, future ISO used, relative, retry-after, defaults', () => {
  const now = Date.parse('2026-10-15T08:00:00Z');
  assert.strictEqual(M.parseReset(W.WORKERS.cline, '{"ts":"2026-10-15T07:59:00Z"} limit', now).how, 'utc_midnight');
  assert.strictEqual(M.parseReset(W.WORKERS.cline, 'resets at 2026-10-15T12:00:00Z', now).at, Date.parse('2026-10-15T12:00:00Z'));
  assert.strictEqual(M.parseReset(W.WORKERS.cline, 'Try again in 5h 29m', now).at, now + (5 * 3600 + 29 * 60) * 1000);
  assert.strictEqual(M.parseReset(W.WORKERS.kilo, 'retry-after: 90', now).how, 'retry_after');
  const nh = M.parseReset(W.WORKERS.kilo, 'Too Many Requests', now); assert.strictEqual(nh.how, 'next_hour'); assert.ok(nh.at > now && nh.at <= now + 3600e3);
  assert.strictEqual(M.parseReset(W.WORKERS.opencode, 'x', now).at, Date.parse('2026-10-16T00:00:00Z'));
  assert.strictEqual(M.parseReset(W.WORKERS.cline, 'reset 2099-01-01T00:00:00Z', now).how, 'utc_midnight'); // absurd future ignored
});
test('state: corrupt / non-dict / clock-skewed entries are ignored', () => {
  const now = Date.now();
  assert.ok(!M.validEntry({ reset_at: 'x' }, now));
  assert.ok(!M.validEntry({ reset_at: now - 1 }, now));
  assert.ok(!M.validEntry({ reset_at: now + 3600e3, marked_at: now + 86400e3 }, now)); // clock went back
  assert.ok(!M.validEntry({ reset_at: now + 30 * 86400e3 }, now));
  assert.ok(M.validEntry({ reset_at: now + 3600e3, marked_at: now }, now));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'st-')); process.env.CREW_STATE_DIR = d;
  fs.writeFileSync(path.join(d, 'kilo-quota-state.json'), '{not json');
  assert.deepStrictEqual(M.exhaustedMap(W.WORKERS.kilo), {});
  fs.writeFileSync(path.join(d, 'kilo-quota-state.json'), '[1,2]');
  assert.deepStrictEqual(M.exhaustedMap(W.WORKERS.kilo), {});
  delete process.env.CREW_STATE_DIR;
});
test('state: 24 concurrent writers -> valid JSON with every model (lock + atomic rename)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  const code = `process.env.CREW_STATE_DIR=${JSON.stringify(d)};const M=require(${JSON.stringify(path.resolve(__dirname, '../lib/models'))});const W=require(${JSON.stringify(path.resolve(__dirname, '../lib/workers'))});for(let i=0;i<5;i++)M.markExhausted(W.WORKERS.kilo,'kilo/m'+process.argv[1]+'-'+i,'429');`;
  const ps = Array.from({ length: 24 }, (_, i) => cp.spawn(process.execPath, ['-e', code, String(i)], { stdio: 'ignore' }));
  return Promise.all(ps.map((p) => new Promise((r) => p.on('close', r)))).then(() => {
    const st = JSON.parse(fs.readFileSync(path.join(d, 'kilo-quota-state.json'), 'utf8'));
    assert.strictEqual(Object.keys(st).length, 120);
    assert.deepStrictEqual(fs.readdirSync(d).filter((f) => f.includes('.tmp.') || f.endsWith('.lockdir')), []);
  });
});
test('freePool: live fetch times out in ~3s and falls back to builtin when offline', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-')); process.env.CREW_STATE_DIR = d;
  process.env.CREW_KILO_URL = 'http://10.255.255.1:81/models'; // blackhole
  const t0 = Date.now(); const p = await M.freePool(W.WORKERS.kilo, { override: '' });
  assert.strictEqual(p.src, 'builtin'); assert.ok(Date.now() - t0 < 6000, 'fetch timeout honoured');
  fs.writeFileSync(path.join(d, 'kilo-free-models.json'), JSON.stringify({ fetched_at: 1, models: ['kilo/old'] }));
  const p2 = await M.freePool(W.WORKERS.kilo, { override: '' }); assert.strictEqual(p2.src, 'stale_cache');
  delete process.env.CREW_KILO_URL; delete process.env.CREW_STATE_DIR;
});
test('parseFree: kilo excludes non-text/aux models, opencode keeps *-free + big-pickle', () => {
  assert.deepStrictEqual(W.WORKERS.kilo.parseFree({ data: [{ id: 'a/b', isFree: true }, { id: 'a/c', isFree: false }, { id: 'x/tts-1', isFree: true }, { id: 'g/lyria', isFree: true }, { id: 'm/img', isFree: true, architecture: { output_modalities: ['image'] } }] }), ['kilo/a/b']);
  assert.deepStrictEqual(W.WORKERS.opencode.parseFree({ data: [{ id: 'x-free' }, { id: 'big-pickle' }, { id: 'paid' }] }), ['opencode/x-free', 'opencode/big-pickle']);
  assert.deepStrictEqual(W.WORKERS.cline.parseFree({ free: [{ id: 'cline-free/q' }] }), ['cline-free/q']);
});
test('cline prompt sanitizer: all-Chinese + full-width punctuation gets ASCII frame', () => {
  const s = W.sanitizeForCline('请复核这个文件，找出问题。');
  assert.ok(/^Task \(/.test(s) && !/[，。]/.test(s));
  assert.strictEqual(W.sanitizeForCline('Review file foo.js please'), 'Review file foo.js please');
  assert.ok(!W.WORKERS.cline.taskArgs({ prompt: 'x', model: 'm' }).includes('-p'));
});
