'use strict';
// Region block list (v1.3.3, = model_gate.region_* + cline-auto v3.6 / opencode-auto v1.3+).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const R = require('../lib/region');
const { sandbox, crew, calls } = require('./helpers');

const blockFile = (sb) => path.join(sb.env.CREW_HOME, 'config', 'region-blocked-models.json');
const readBlock = (sb) => { try { return JSON.parse(fs.readFileSync(blockFile(sb), 'utf8')); } catch (_) { return null; } };
const writeBlock = (sb, models) => { fs.mkdirSync(path.dirname(blockFile(sb)), { recursive: true }); fs.writeFileSync(blockFile(sb), JSON.stringify({ models })); };
const models = (sb) => calls(sb).map((c) => c.argv[c.argv.indexOf('-m') + 1]);
const log = (sb, f) => { try { return fs.readFileSync(path.join(sb.env.CREW_HOME, 'logs', f), 'utf8'); } catch (_) { return ''; } };
const now = () => Date.now() / 1000;

test('region match: provider region refusals yes; quota / other errors no', () => {
  assert.ok(R.match('\x1b[31merror:\x1b[0m access forbidden: cline-free/x is not available in your region (Request ID: a)'));
  assert.ok(R.match('Error: 403 {"code":"unsupported_country_region_territory"}'));
  assert.ok(R.match('This model is restricted in your country'));
  for (const s of ['Rate limit exceeded (429)', 'Error: provider returned an invalid response', 'Daily free model limit reached', '',
    '-rw-r--r--@   1 me  wheel   1052 Oct 18 01:43 region-blocked-models.example.json', '2026-10-18 pid=1 region_blocked model=x rc=1 err=forbidden',
    "    case 'region': console.error(`error: access forbidden: ${model} is not available in your region`);  // lib/region.js"]) assert.strictEqual(R.match(s), null, s);
});
test('a region refusal blocks the model for 7 days and switches to the next model at once (no retry)', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: 'cline/a=region' });
  const r = crew(['run', 'cline', 'hi'], sb); assert.strictEqual(r.rc, 0, r.err);
  assert.deepStrictEqual(models(sb), ['cline/a', 'cline/b']);
  const e = readBlock(sb).models['cline/a']; assert.ok(e, 'written to the block list');
  assert.strictEqual(e.count, 1); assert.match(e.error, /not available in your region/);
  assert.ok(e.next_retry_ts - now() > 6.9 * 86400 && e.next_retry_ts - now() < 7.1 * 86400);
  assert.match(log(sb, 'cline.log'), /region_blocked model=cline\/a/);
  const ev = log(sb, 'events.jsonl').trim().split('\n').map(JSON.parse);
  assert.ok(ev.some((x) => x.event === 'switch' && x.reason === 'region_blocked' && x.model === 'cline/b'));
  crew(['run', 'cline', 'hi'], sb); assert.deepStrictEqual(models(sb).slice(2), ['cline/b'], 'blocked model skipped next time');
  assert.match(log(sb, 'cline.log'), /region_skip model=cline\/a/);
});
test('--model is never region-skipped; a due entry is probed once and cleared on success', () => {
  const sb = sandbox();
  writeBlock(sb, { 'kilo/a': { next_retry_ts: now() + 86400, next_retry_at: 'x', count: 1 } });
  crew(['run', 'kilo', '--model', 'kilo/a', 'hi'], sb); assert.deepStrictEqual(models(sb), ['kilo/a']);
  assert.ok(!readBlock(sb).models['kilo/a'], 'success on the blocked model removes it');
  assert.match(log(sb, 'kilo.log'), /region_recovered model=kilo\/a/);
  const sb2 = sandbox();
  writeBlock(sb2, { 'kilo/a': { next_retry_ts: now() - 10, next_retry_at: 'past', count: 2 } });
  crew(['run', 'kilo', 'hi'], sb2); assert.deepStrictEqual(models(sb2), ['kilo/a']);
  assert.match(log(sb2, 'kilo.log'), /region_retry_due model=kilo\/a/); assert.ok(!readBlock(sb2).models['kilo/a']);
});
test('a due probe is claimed, so a concurrent planner skips it; malformed entries count as blocked', () => {
  const sb = sandbox();
  writeBlock(sb, { 'opencode/a': { next_retry_ts: now() - 10 }, 'opencode/b': { next_retry_ts: 'bad' } });
  const old = process.env.MODEL_REGION_BLOCK_FILE; process.env.MODEL_REGION_BLOCK_FILE = blockFile(sb);
  try {
    const i1 = []; const a = R.filter(['opencode/a', 'opencode/b', 'opencode/c'], '', i1);
    assert.deepStrictEqual(a.order, ['opencode/a', 'opencode/c']); assert.deepStrictEqual(a.skipped.map((x) => x.model), ['opencode/b']);
    const b = R.filter(['opencode/a', 'opencode/c'], '', []);
    assert.deepStrictEqual(b.order, ['opencode/c'], 'second planner sees the claim');
    assert.deepStrictEqual(R.filter(['opencode/b'], 'opencode/b', []).order, ['opencode/b'], 'pref kept');
  } finally { if (old === undefined) delete process.env.MODEL_REGION_BLOCK_FILE; else process.env.MODEL_REGION_BLOCK_FILE = old; }
});
test('crew quota lists region-blocked models as info', () => {
  const sb = sandbox();
  writeBlock(sb, { 'cline/a': { next_retry_ts: now() + 86400, next_retry_at: '2099-01-01T00:00:00+08:00' } });
  const r = crew(['quota', 'cline', '--json'], sb); assert.strictEqual(r.rc, 0, r.err);
  const a = JSON.parse(r.out).agents[0];
  assert.deepStrictEqual(a.region_skipped.map((x) => x.model), ['cline/a']);
  assert.ok(a.notes.some((n) => /地区不可用 cline\/a/.test(n)));
});
