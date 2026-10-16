'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const { sandbox, crew, calls, state, CREW } = require('./helpers');
const unix = process.platform !== 'win32';

test('limit on first model -> switches to next, records cooldown', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: 'kilo/a=limit' });
  const r = crew(['run', 'kilo', 'hello'], sb);
  assert.strictEqual(r.rc, 0, r.err); assert.match(r.out, /\[kilo:kilo\/b\] OK/);
  const st = state(sb, 'kilo'); assert.ok(st['kilo/a'] && st['kilo/a'].reset_at > Date.now());
  assert.strictEqual(st['kilo/a'].source, 'next_hour'); // the past {"ts":...} stamp in the error was ignored
  const r2 = crew(['run', 'kilo', 'again'], sb); // cooled model is skipped on the next run
  assert.strictEqual(r2.rc, 0); assert.deepStrictEqual(calls(sb).slice(-1)[0].argv.slice(-2, -1), ['kilo/b']);
});
test('all models exhausted -> exit 75 with human message; next run exits 75 without calling the CLI', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: '*=limit' });
  const r = crew(['run', 'opencode', 'hi'], sb);
  assert.strictEqual(r.rc, 75); assert.match(r.err, /额度都已用尽.*最早/);
  const n = calls(sb).length; const r2 = crew(['run', 'opencode', 'hi'], sb);
  assert.strictEqual(r2.rc, 75); assert.strictEqual(calls(sb).length, n);
});
test('cline rc=0 limit: only its own error line counts, model text quoting the phrase does not', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: 'cline/a=quote_limit' });
  const r = crew(['run', 'cline', 'explain limits'], sb);
  assert.strictEqual(r.rc, 0); assert.strictEqual(state(sb, 'cline'), null);
  const sb2 = sandbox({ FAKE_BEHAVIOR: 'cline/a=limit' });
  const r2 = crew(['run', 'cline', 'x'], sb2);
  assert.strictEqual(r2.rc, 0); assert.match(r2.out, /cline:cline\/b/);
  assert.strictEqual(state(sb2, 'cline')['cline/a'].source, 'relative'); // "Try again in 2h 10m"
});
test('kilo/opencode stdout text quoting "Rate limit exceeded" with rc 0 is not a limit', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: 'opencode/a=quote_limit' });
  assert.strictEqual(crew(['run', 'opencode', 'x'], sb).rc, 0); assert.strictEqual(state(sb, 'opencode'), null);
});
test('limit printed by a CLI that then hangs is detected live and killed (limit wins over timeout)', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: 'kilo/a=limit_hang' });
  const t0 = Date.now(); const r = crew(['run', 'kilo', 'x', '--timeout', '4'], sb);
  assert.strictEqual(r.rc, 0, r.err); assert.ok(Date.now() - t0 < 20000);
  assert.strictEqual(state(sb, 'kilo')['kilo/a'].source, 'retry_after');
});
test('total timeout -> 124, child process tree killed (no leftovers)', { skip: !unix }, () => {
  const sb = sandbox({ FAKE_BEHAVIOR: '*=hang', FAKE_PIDFILE: '' });
  sb.env.FAKE_PIDFILE = path.join(sb.home, 'pid');
  const r = crew(['run', 'opencode', 'x', '--timeout', '3'], sb);
  assert.strictEqual(r.rc, 124); assert.match(r.err, /总时限/);
  const pid = +fs.readFileSync(sb.env.FAKE_PIDFILE, 'utf8');
  let alive = true; try { process.kill(pid, 0); } catch (_) { alive = false; } assert.ok(!alive, 'fake CLI must be dead');
});
test('idle watchdog: silent CLI killed -> 124', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: '*=silent', CREW_IDLE_TIMEOUT: '3' });
  const r = crew(['run', 'kilo', 'x'], sb); assert.strictEqual(r.rc, 124); assert.match(r.err, /无任何输出/);
});
test('network error retried once on the same model', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: 'kilo/a=net_once' });
  const r = crew(['run', 'kilo', 'x'], sb); assert.strictEqual(r.rc, 0); assert.match(r.out, /recovered/);
  assert.strictEqual(calls(sb).length, 2);
});
test('auth error -> 77 with login hint, no model switching', () => {
  const sb = sandbox({ FAKE_BEHAVIOR: '*=auth' });
  const r = crew(['run', 'cline', 'x'], sb); assert.strictEqual(r.rc, 77); assert.match(r.err, /cline auth/); assert.strictEqual(calls(sb).length, 1);
});
test('missing CLI -> 127', () => {
  const sb = sandbox({ CREW_KILO_BIN: '/nonexistent/kilo' });
  assert.strictEqual(crew(['run', 'kilo', 'x'], sb).rc, 127);
});
test('cline: never uses -p, forces act mode while running and restores planActMode after', () => {
  const sb = sandbox();
  const r = crew(['run', 'cline', '请复核这个文件，找出问题。'], sb); assert.strictEqual(r.rc, 0);
  const c = calls(sb)[0]; assert.ok(!c.argv.includes('-p')); assert.match(c.argv.at(-1), /^READ-ONLY|Task \(/);
  const gs = JSON.parse(fs.readFileSync(path.join(sb.home, '.cline/data/settings/global-settings.json'), 'utf8'));
  assert.strictEqual(gs.planActMode, 'plan'); assert.strictEqual(gs.other, 1);
});
test('cline act mode is ref-counted across concurrent runs', async () => {
  const sb = sandbox({ FAKE_BEHAVIOR: '*=slow' });
  const run = () => new Promise((res) => cp.spawn(process.execPath, [CREW, 'run', 'cline', 'x'], { env: sb.env, stdio: 'ignore' }).on('close', res));
  const gsf = path.join(sb.home, '.cline/data/settings/global-settings.json');
  const p = Promise.all([run(), new Promise((r) => setTimeout(r, 800)).then(run)]);
  await new Promise((r) => setTimeout(r, 2000));
  assert.strictEqual(JSON.parse(fs.readFileSync(gsf, 'utf8')).planActMode, 'act');
  const codes = await p; assert.deepStrictEqual(codes, [0, 0]);
  assert.strictEqual(JSON.parse(fs.readFileSync(gsf, 'utf8')).planActMode, 'plan');
});
test('exec (shim mode): raw args pass through, -m becomes preferred model, kilo gets --auto', () => {
  const sb = sandbox();
  const r = crew(['exec', 'kilo', 'run', '-m', 'kilo/c', 'do it'], sb); assert.strictEqual(r.rc, 0, r.err);
  const c = calls(sb)[0]; assert.deepStrictEqual(c.argv, ['run', '--auto', 'do it', '-m', 'kilo/c']);
  const v = crew(['exec', 'opencode', '--version'], sb); assert.match(v.out, /9.9.9-fake/);
});
test('exec: cline short --timeout dropped; -p warns it is plan mode', () => {
  const sb = sandbox();
  crew(['exec', 'cline', '--timeout', '240', 'review x'], sb);
  assert.ok(!calls(sb)[0].argv.includes('240'));
  const r = crew(['exec', 'cline', '-p', 'review x'], sb); assert.match(r.err, /plan/);
});
test('stdin: a never-closed pipe does not hang exec mode', { skip: !unix }, async () => {
  const sb = sandbox();
  const ch = cp.spawn(process.execPath, [CREW, 'exec', 'opencode', 'run', 'x'], { env: { ...sb.env, CREW_STDIN_WAIT: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const t0 = Date.now(); const code = await new Promise((r) => ch.on('close', r));
  assert.strictEqual(code, 0); assert.ok(Date.now() - t0 < 15000); ch.stdin.destroy();
});
test('stdin: piped data is forwarded to the CLI', () => {
  const sb = sandbox({ FAKE_READ_STDIN: '1' });
  const r = crew(['exec', 'opencode', 'run', 'x'], sb, { input: 'piped-context' }); assert.match(r.out, /STDIN=piped-context/);
});
test('long prompt is handed over as a file (Windows command-line limit)', () => {
  const sb = sandbox();
  const r = crew(['run', 'kilo', 'x'.repeat(9000)], sb); assert.strictEqual(r.rc, 0);
  assert.match(calls(sb)[0].argv.at(-1), /The full task is in the file/);
});
