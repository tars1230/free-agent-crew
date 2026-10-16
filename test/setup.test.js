'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const { sandbox, crew } = require('./helpers');

test('setup --no-cli: shims, PATH rc, skill, rank tables; idempotent; never overwrites foreign files', { skip: process.platform === 'win32' }, () => {
  const sb = sandbox({ SHELL: '/bin/zsh' });
  fs.mkdirSync(path.join(sb.home, '.claude', 'skills', 'free-agent-crew'), { recursive: true });
  fs.mkdirSync(path.join(sb.home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(sb.home, '.claude', 'skills', 'free-agent-crew', 'SKILL.md'), 'someone else\n');
  fs.writeFileSync(path.join(sb.home, '.zshrc'), 'export FOO=1\n');
  const r1 = crew(['setup', '--no-cli'], sb); assert.strictEqual(r1.rc, 0, r1.out + r1.err);
  const r2 = crew(['setup', '--no-cli'], sb); assert.strictEqual(r2.rc, 0);
  const bin = path.join(sb.env.CREW_HOME, 'bin');
  for (const n of ['crew', 'crew-cline', 'crew-kilo', 'crew-opencode']) assert.ok(fs.existsSync(path.join(bin, n)), n);
  const rc = fs.readFileSync(path.join(sb.home, '.zshrc'), 'utf8');
  assert.strictEqual(rc.split('>>> free-agent-crew >>>').length, 2); assert.match(rc, /export FOO=1/);
  assert.strictEqual(fs.readFileSync(path.join(sb.home, '.claude', 'skills', 'free-agent-crew', 'SKILL.md'), 'utf8'), 'someone else\n');
  const sk = fs.readFileSync(path.join(sb.home, '.codex', 'skills', 'free-agent-crew', 'SKILL.md'), 'utf8');
  assert.match(sk, /free-agent-crew-skill/); assert.ok(sk.includes(process.execPath));
  assert.ok(fs.existsSync(path.join(sb.env.CREW_HOME, 'config', 'kilo-model-rank.json')));
  // the shim really works through /bin/sh with an empty-ish PATH
  const cp = require('child_process');
  const v = cp.spawnSync(path.join(bin, 'crew'), ['version'], { env: { ...sb.env, PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
  assert.strictEqual(v.status, 0); assert.match(v.stdout, /^\d+\.\d+\.\d+/);
});
test('setup: an existing foreign kilo-auto on PATH is not shadowed', { skip: process.platform === 'win32' }, () => {
  const sb = sandbox();
  const other = path.join(sb.home, 'otherbin'); fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'kilo-auto'), '#!/bin/sh\necho mine\n', { mode: 0o755 });
  const r = crew(['setup', '--no-cli', '--no-path', '--no-skills'], sb, { env: { PATH: other + ':' + process.env.PATH } });
  assert.strictEqual(r.rc, 0); assert.match(r.out, /跳过 kilo-auto/);
  assert.ok(!fs.existsSync(path.join(sb.env.CREW_HOME, 'bin', 'kilo-auto')));
});
test('disableAutoUpdate: creates config when absent, never rewrites JSONC', { skip: process.platform === 'win32' }, () => {
  const sb = sandbox();
  fs.mkdirSync(path.join(sb.home, '.config', 'kilo'), { recursive: true });
  fs.writeFileSync(path.join(sb.home, '.config', 'kilo', 'kilo.jsonc'), '// mine\n{}');
  crew(['setup', '--no-cli', '--no-path', '--no-skills'], sb);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(sb.home, '.config', 'opencode', 'opencode.json'), 'utf8')).autoupdate, false);
  assert.strictEqual(fs.readFileSync(path.join(sb.home, '.config', 'kilo', 'kilo.jsonc'), 'utf8'), '// mine\n{}');
});
