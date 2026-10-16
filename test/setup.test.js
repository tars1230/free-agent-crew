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

test('skill dir: Agent Skills frontmatter valid; setup installs SKILL.md + references (templated), upgrades an older crew skill', { skip: process.platform === 'win32' }, () => {
  const src = path.join(__dirname, '..', 'skills', 'free-agent-crew');
  const md = fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8');
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(fm, 'frontmatter');
  const name = (fm[1].match(/^name:\s*(.+)$/m) || [])[1]; const desc = (fm[1].match(/^description:\s*(.+)$/m) || [])[1];
  assert.strictEqual(name, path.basename(src)); assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/); assert.ok(name.length <= 64);
  assert.ok(desc && desc.length > 20 && desc.length <= 1024, 'description length');
  assert.ok(md.split('\n').length < 500, 'SKILL.md stays short');
  for (const m of md.matchAll(/\]\((references\/[^)]+)\)/g)) assert.ok(fs.existsSync(path.join(src, m[1])), 'link ' + m[1]);
  assert.strictEqual(require('../package.json').version, (md.match(/version:\s*"([^"]+)"/) || [])[1], 'skill metadata.version == package version');
  const sb = sandbox({ SHELL: '/bin/zsh' });
  for (const h of ['.cline', '.kilo', '.codebuddy']) fs.mkdirSync(path.join(sb.home, h), { recursive: true });
  const old = path.join(sb.home, '.agents', 'skills', 'free-agent-crew'); fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'SKILL.md'), '<!-- free-agent-crew-skill v1 -->\nold\n');
  const r = crew(['setup', '--no-cli', '--no-path'], sb); assert.strictEqual(r.rc, 0, r.out + r.err);
  for (const d of [path.join(sb.env.CREW_HOME, 'skill', 'free-agent-crew'), old, ...['.cline', '.kilo', '.codebuddy'].map((h) => path.join(sb.home, h, 'skills', 'free-agent-crew'))]) {
    const s = fs.readFileSync(path.join(d, 'SKILL.md'), 'utf8'); assert.match(s, /free-agent-crew-skill v2/, d);
    assert.ok(!s.includes('{{CREW_'), 'templated ' + d);
    const t = fs.readFileSync(path.join(d, 'references', 'troubleshooting.md'), 'utf8');
    assert.ok(t.includes(process.execPath) && !t.includes('{{CREW_'), 'references templated ' + d);
    assert.ok(fs.existsSync(path.join(d, 'references', 'commands.md')));
  }
});

test('installSkill targets use the agent name (".config/opencode" -> "opencode")', () => {
  const sb = sandbox({}); const old = { ...process.env }; Object.assign(process.env, sb.env, { HOME: sb.home, USERPROFILE: sb.home });
  try {
    delete require.cache[require.resolve('../lib/setup')];
    const out = require('../lib/setup').installSkill(process.execPath, '/x/crew.js', { targets: ['opencode', 'kilo'] });
    for (const h of ['.config/opencode', '.kilo']) assert.ok(fs.existsSync(path.join(sb.home, h, 'skills', 'free-agent-crew', 'references', 'commands.md')), h + ' ' + out.join('\n'));
    assert.ok(!fs.existsSync(path.join(sb.home, '.claude', 'skills', 'free-agent-crew')));
  } finally { process.env = old; }
});
