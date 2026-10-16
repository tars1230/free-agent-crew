'use strict';
// crew quota (v1.3.0): colour rules, counts, kilo hour note, events written by real (stub) runs, never touches the network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const { sandbox, crew } = require('./helpers');

const RANK = { models: { 'kilo/a': { score: 90, tb: 40 }, 'kilo/b': { score: 70, tb: 20 }, 'kilo/p': { score: 65, evidence: 'vendor' }, 'kilo/top': { score: 99, tb: 50 }, 'kilo/weak': { score: 30 } } };
function sb(models = 'kilo/a,kilo/b,kilo/p,kilo/weak') {
  const s = sandbox({ CREW_KILO_FREE_MODELS: models, MODEL_BENCH_URL: 'http://127.0.0.1:9/never' });
  const cfg = path.join(s.env.CREW_HOME, 'config'); fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'kilo-model-rank.json'), JSON.stringify(RANK));
  return s;
}
const cool = (s, ...ms) => { const d = path.join(s.env.CREW_HOME, 'state'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'kilo-quota-state.json'), JSON.stringify(Object.fromEntries(ms.map((m) => [m, { reset_at: Date.now() + 3600e3, marked_at: Date.now() }])))); };
const q = (s, extra = []) => { const r = crew(['quota', 'kilo', '--json', ...extra], s); assert.strictEqual(r.rc, 0, r.err); return JSON.parse(r.out).agents[0]; };
const iso = (t) => new Date(t).toISOString();

test('quota colours: green / green while best cools / yellow only provisional / red all cooling / red none eligible', () => {
  const s = sb();
  let a = q(s); assert.strictEqual(a.status, 'green'); assert.strictEqual(a.preferred_model, 'kilo/a');
  assert.ok(a.notes.some((n) => n.includes('kilo/top') && n.includes('不在当前免费名单')), 'rank-top note is info only');
  assert.deepStrictEqual(a.degraded_reasons, []);
  assert.strictEqual(a.gate_excluded_count, 1); assert.strictEqual(a.provisional_count, 1); assert.strictEqual(a.min_score, 60);
  assert.match(a.hour_note, /次请求\/小时·IP，单次调用可能含多次请求/);
  cool(s, 'kilo/a'); a = q(s); assert.strictEqual(a.status, 'green'); assert.strictEqual(a.preferred_model, 'kilo/b');
  assert.ok(a.notes.some((n) => n.includes('冷却中'))); assert.strictEqual(a.cooling[0].model, 'kilo/a');
  cool(s, 'kilo/a', 'kilo/b'); a = q(s); assert.strictEqual(a.status, 'yellow'); assert.strictEqual(a.preferred_model, 'kilo/p');
  cool(s, 'kilo/a', 'kilo/b', 'kilo/p'); a = q(s); assert.strictEqual(a.status, 'red'); assert.strictEqual(a.preferred_model, null);
  a = q(sb('kilo/weak')); assert.strictEqual(a.status, 'red'); assert.match(a.degraded_reasons.join(), /没有达标/);
});

test('quota gray: CLI not installed', () => {
  const s = sb(); const a = q({ ...s, env: { ...s.env, CREW_KILO_BIN: '/nonexistent/kilo', PATH: '/usr/bin:/bin' } });
  assert.strictEqual(a.status, 'unknown'); assert.strictEqual(a.installed, false);
});

test('quota counts from events: calls, success rate, unknown, last failure, kilo hour, foreign lines tolerated', () => {
  const s = sb(); const now = Date.now(); const ev = path.join(s.env.CREW_HOME, 'logs'); fs.mkdirSync(ev, { recursive: true });
  const L = [
    { ts: iso(now - 60e3), agent: 'kilo', event: 'start', run: 'r1' }, { ts: iso(now - 50e3), agent: 'kilo', event: 'done', rc: 0, model: 'kilo/a', run: 'r1' },
    { ts: iso(now - 40e3), agent: 'kilo', event: 'start', run: 'r2' }, { ts: iso(now - 30e3), agent: 'kilo', event: 'quota_exhausted', rc: 75, run: 'r2' },
    { ts: iso(now - 20e3), agent: 'kilo', event: 'start', run: 'r3' },                                   // killed: no terminal event
    { ts: iso(now - 10e3), agent: 'kilo', event: 'start', run: 'r4' }, { ts: iso(now - 5e3), agent: 'kilo', event: 'done', rc: 143, reason: 'signal_TERM', model: 'kilo/b', run: 'r4' },
    { ts: iso(now - 3 * 86400e3), agent: 'kilo', event: 'done', rc: 0, run: 'old' },
    { ts: iso(now - 1e3), agent: 'opencode', event: 'start', run: 'x' },
  ];
  fs.writeFileSync(path.join(ev, 'events.jsonl'), L.map((e) => JSON.stringify(e)).join('\n') + '\nnot json\n{"half":\n');
  const a = q(s);
  assert.strictEqual(a.calls_today, 4); assert.strictEqual(a.outcome_known_today, 3); assert.strictEqual(a.success_today, 1);
  assert.strictEqual(a.success_rate, 0.333); assert.strictEqual(a.unknown_today, 1);
  assert.strictEqual(a.last_failure.outcome, 'signal'); assert.strictEqual(a.last_failure.model, 'kilo/b');
  assert.ok(a.hour_used >= 1 && a.hour_used <= 4);
  const txt = crew(['quota'], s); assert.strictEqual(txt.rc, 0); assert.match(txt.out, /kilo {2}今日 4 次 · 成功率 33%（1 次无结束记录）/);
});

test('real stub run writes start + done events (agent-events shape, no prompt text)', () => {
  const s = sb('kilo/a'); const r = crew(['run', 'kilo', 'SECRET-PROMPT-TEXT'], s, { env: { AGENT_CALLER: 'tester' } }); assert.strictEqual(r.rc, 0, r.err);
  const lines = fs.readFileSync(path.join(s.env.CREW_HOME, 'logs', 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepStrictEqual(lines.map((e) => e.event), ['start', 'done']);
  for (const e of lines) for (const k of ['ts', 'agent', 'caller', 'session_id', 'model', 'event', 'rc', 'duration', 'tokens', 'run']) assert.ok(k in e, k);
  assert.strictEqual(lines[1].rc, 0); assert.strictEqual(lines[1].model, 'kilo/a'); assert.strictEqual(lines[0].run, lines[1].run); assert.strictEqual(lines[0].caller, 'tester');
  assert.ok(!JSON.stringify(lines).includes('SECRET-PROMPT-TEXT'));
  const a = q(s); assert.strictEqual(a.calls_today, 1); assert.strictEqual(a.success_rate, 1);
});

test('runsOf keeps the specific failure when a non-zero done follows it', () => {
  const Q = require('../lib/quota');
  const ev = [{ ts: '2026-10-16T01:00:00Z', agent: 'kilo', event: 'start', run: 'r1' }, { ts: '2026-10-16T01:00:01Z', agent: 'kilo', event: 'quota_exhausted', rc: 75, run: 'r1' }, { ts: '2026-10-16T01:00:02Z', agent: 'kilo', event: 'done', rc: 75, run: 'r1' },
    { ts: '2026-10-16T01:00:00Z', agent: 'kilo', event: 'start', run: 'r2' }, { ts: '2026-10-16T01:00:02Z', agent: 'kilo', event: 'done', rc: 1, run: 'r2' }];
  const o = Object.fromEntries(Q.runsOf(ev, 'kilo').map((r, i) => [i, r.outcome]));
  assert.deepStrictEqual(o, { 0: 'quota', 1: 'error' });
});
