'use strict';
// Tray (v1.3.0). macOS: really compile the menu-bar app and run it for a few seconds in a sandbox (never registered with launchd).
// Windows/Linux parts: static checks only here (Windows script is syntax-checked with PowerShell separately; not run on real Windows).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const { sandbox, crew, ROOT } = require('./helpers');

const hasSwiftc = process.platform === 'darwin' && cp.spawnSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' }).status === 0;
test('macOS tray: build + plist in sandbox, app runs >= 4 s without crashing, uninstall removes everything', { skip: !hasSwiftc || process.env.CREW_TEST_TRAY === '0', timeout: 300000 }, async () => {
  const s = sandbox({ CREW_TRAY_NO_LAUNCH: '1' });
  const r = crew(['tray', 'install'], s, { timeout: 280000 }); assert.strictEqual(r.rc, 0, r.out + r.err);
  const app = path.join(s.env.CREW_HOME, 'tray', 'CrewQuota.app'); const bin = path.join(app, 'Contents', 'MacOS', 'CrewQuota');
  const plist = path.join(s.home, 'Library', 'LaunchAgents', 'io.github.free-agent-crew.quota.plist');
  assert.ok(fs.existsSync(bin)); assert.ok(fs.existsSync(plist));
  const px = fs.readFileSync(plist, 'utf8'); assert.match(px, /<string>io\.github\.free-agent-crew\.quota<\/string>/); assert.ok(px.includes(bin));
  const cfg = JSON.parse(fs.readFileSync(path.join(s.env.CREW_HOME, 'tray', 'tray.json'), 'utf8')); assert.strictEqual(cfg.node, process.execPath);
  assert.match(crew(['tray', 'status'], s).out, /已安装/);
  const child = cp.spawn(bin, [], { env: { ...s.env, CREW_NODE: process.execPath, CREW_ENTRY: path.join(ROOT, 'bin', 'crew.js') }, stdio: 'ignore' });
  let exited = null; child.on('exit', (c, sig) => { exited = [c, sig]; });
  await new Promise((res) => setTimeout(res, 4500));
  assert.strictEqual(exited, null, 'tray app exited early: ' + JSON.stringify(exited));
  child.kill('SIGTERM'); await new Promise((res) => setTimeout(res, 500));
  const u = crew(['tray', 'uninstall'], s); assert.strictEqual(u.rc, 0);
  assert.ok(!fs.existsSync(plist) && !fs.existsSync(app));
  assert.match(crew(['tray', 'status'], s).out, /未安装/);
});

test('tray static: plist escapes paths; Windows script passes values via env, self-exits when removed; Linux prints guidance', () => {
  const T = require('../lib/tray');
  const old = process.env.CREW_HOME; process.env.CREW_HOME = '/tmp/a&b<c>';
  try { const x = T.plistXml(); assert.ok(x.includes('/tmp/a&amp;b&lt;c&gt;')); assert.ok(!x.includes('a&b')); } finally { if (old === undefined) delete process.env.CREW_HOME; else process.env.CREW_HOME = old; }
  const ps = fs.readFileSync(path.join(ROOT, 'tray', 'windows', 'crew-tray.ps1'), 'utf8');
  assert.match(ps, /System\.Windows\.Forms\.NotifyIcon/); assert.match(ps, /-not \(Test-Path \$Self\)/); assert.match(ps, /\$IconCache/);
  const js = fs.readFileSync(path.join(ROOT, 'lib', 'tray.js'), 'utf8'); assert.match(js, /\$env:CREW_LNK/); assert.match(js, /\$env:CREW_ARGS/);
  const l = T.install(process.execPath, '/x', 'linux'); assert.strictEqual(l.ok, false); assert.match(l.msgs[0], /crew quota --line/);
  assert.ok(T.uninstall('linux').ok);
});

test('quota --line and setup --tray/--uninstall-tray wiring (no launch)', () => {
  const s = sandbox({ CREW_TRAY_NO_LAUNCH: '1' });
  const l = crew(['quota', '--line'], s); assert.strictEqual(l.rc, 0); assert.match(l.out.trim(), /^cline.+ kilo.+ opencode.+$/u);
  const u = crew(['setup', '--no-cli', '--no-path', '--no-skills', '--uninstall-tray'], s); assert.strictEqual(u.rc, 0, u.err); assert.match(u.out, /托盘\] 卸载/);
});
