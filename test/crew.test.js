'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const { sandbox, crew, calls } = require('./helpers');

test('review: parallel on all workers, read-only guard, synthesis, exit 0', () => {
  const sb = sandbox();
  const r = crew(['review', '检查 foo.js'], sb, { timeout: 120000 });
  assert.strictEqual(r.rc, 0, r.err);
  assert.match(r.out, /crew review: 3\/3/); assert.match(r.out, /## 汇总（由 /);
  const c = calls(sb); assert.strictEqual(c.length, 4);
  assert.ok(c.every((x) => /READ-ONLY/.test(x.argv.at(-1))));
  const dir = r.out.match(/全部原始输出: (.+)_/)[1];
  assert.ok(fs.existsSync(path.join(dir, 'summary.json')) && fs.existsSync(path.join(dir, 'synthesis.md')));
});
test('review: an exhausted worker is skipped, others still deliver', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: 'cline/a=limit,cline/b=limit,cline/c=limit' });
  const r = crew(['review', 'x', '--no-synth', '--json'], sb, { timeout: 120000 });
  const j = JSON.parse(r.out); assert.strictEqual(j.code, 0);
  assert.strictEqual(j.results.find((x) => x.worker === 'cline').rc, 75);
  const r2 = crew(['review', 'x', '--no-synth', '--json'], sb, { timeout: 120000 }); // now skipped without calling cline
  assert.ok(JSON.parse(r2.out).results.find((x) => x.worker === 'cline').skipped);
});
test('ask: falls through to the next worker when the first is out of quota / not installed', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: 'kilo/a=limit,kilo/b=limit,kilo/c=limit', CREW_OPENCODE_BIN: '/nope' });
  const r = crew(['ask', 'hi', '--json'], sb);
  const j = JSON.parse(r.out); assert.strictEqual(j.code, 0); assert.match(j.final, /\[cline:/);
});
test('ask: every worker exhausted -> 75 and the "wait" hint', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: '*=limit' });
  const r = crew(['ask', 'hi'], sb); assert.strictEqual(r.rc, 75); assert.match(r.out, /免费额度都暂时用尽/);
});
test('relay: three stages on different workers, each fed the previous output', () => {
  const sb = sandbox();
  const r = crew(['relay', 'write a haiku', '--json'], sb, { timeout: 120000 });
  const j = JSON.parse(r.out); assert.strictEqual(j.code, 0);
  assert.deepStrictEqual(j.results.map((x) => x.role), ['draft', 'critique+improve', 'finalize']);
  assert.strictEqual(new Set(j.results.map((x) => x.worker)).size, 3);
  assert.match(calls(sb)[1].argv.at(-1), /Previous draft/);
});
test('relay: a failing stage is retried by the next worker', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: 'opencode/a=auth' });
  const j = JSON.parse(crew(['relay', 't', '--json'], sb, { timeout: 120000 }).out);
  assert.strictEqual(j.code, 0); assert.ok(j.results.some((x) => x.worker === 'opencode' && x.rc === 77));
});
test('brainstorm + cross run and exit 0; --workers restricts the crew', () => {
  const sb = sandbox();
  assert.strictEqual(crew(['brainstorm', 'names', '--workers', 'kilo,opencode'], sb, { timeout: 120000 }).rc, 0);
  assert.ok(calls(sb).every((c) => c.name !== 'cline'));
  const j = JSON.parse(crew(['cross', 'fix bug', '--json'], sb, { timeout: 120000 }).out); assert.strictEqual(j.code, 0);
});
test('status/models/reset/doctor --quick work offline with fakes', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: '*=limit' });
  crew(['run', 'kilo', 'x'], sb);
  assert.match(crew(['status'], sb).out, /冷却到/);
  crew(['reset', 'kilo'], sb); assert.doesNotMatch(crew(['status', 'kilo'], sb).out, /冷却到/);
  const d = crew(['doctor', '--quick'], sb, { timeout: 120000 }); assert.match(d.out, /需要你做的事/); assert.match(d.out, /绝对路径调用/);
});
test('usage errors -> 64', () => { const sb = sandbox(); assert.strictEqual(crew(['run', 'nobody', 'x'], sb).rc, 64); assert.strictEqual(crew(['ask'], sb).rc, 64); });
