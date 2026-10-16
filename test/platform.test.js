'use strict';
// Windows logic is tested as pure functions (plat='win32') so it runs on any OS.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/platform');

test('which: win32 honours PATHEXT, case-insensitive skipDirs', () => {
  const files = new Set(['C:\\Users\\u\\AppData\\Roaming\\npm\\cline.cmd', 'C:\\crew\\bin\\cline.cmd']);
  const exists = (f) => files.has(f);
  const env = { Path: 'C:\\crew\\bin;C:\\Users\\u\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.strictEqual(P.which('cline', { env, plat: 'win32', exists }), 'C:\\crew\\bin\\cline.cmd');
  assert.strictEqual(P.which('cline', { env, plat: 'win32', exists, skipDirs: ['c:\\CREW\\bin\\'] }), 'C:\\Users\\u\\AppData\\Roaming\\npm\\cline.cmd');
});
test('npm .cmd shim -> run the JS entry with node (no cmd.exe, no CVE-2024-27980 EINVAL)', () => {
  const shim = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\cline\\bin\\cline" %*\r\n';
  const r = P.resolveSpawn('C:\\Users\\u\\AppData\\Roaming\\npm\\cline.cmd', { plat: 'win32', read: () => shim });
  assert.strictEqual(r.shell, false); assert.strictEqual(r.cmd, process.execPath);
  assert.deepStrictEqual(r.pre, ['C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\cline\\bin\\cline']);
  const u = P.resolveSpawn('C:\\x\\weird.cmd', { plat: 'win32', read: () => '@echo hi' }); assert.strictEqual(u.shell, true);
  assert.deepStrictEqual(P.resolveSpawn('/usr/bin/cline', { plat: 'linux' }), { cmd: '/usr/bin/cline', pre: [], shell: false });
});
test('cmd.exe quoting for the shell fallback', () => {
  assert.strictEqual(P.quoteCmdArg('plain'), 'plain');
  assert.strictEqual(P.quoteCmdArg('a b'), '^"a b^"');
  assert.match(P.quoteCmdArg('x & del *'), /\^&/);
  assert.match(P.quoteCmdArg('100%'), /\^%/);
});
test('mergePathList: idempotent, win32 case/trailing-slash insensitive, prepends', () => {
  const a = P.mergePathList('C:\\Windows;C:\\Crew\\Bin\\', ['c:\\crew\\bin'], 'win32'); assert.strictEqual(a.changed, false);
  const b = P.mergePathList('C:\\Windows', ['C:\\crew\\bin'], 'win32'); assert.strictEqual(b.value, 'C:\\crew\\bin;C:\\Windows');
  const c = P.mergePathList('/usr/bin:/bin', ['/h/.free-agent-crew/bin'], 'linux'); assert.strictEqual(c.value, '/h/.free-agent-crew/bin:/usr/bin:/bin');
  assert.strictEqual(P.mergePathList(c.value, ['/h/.free-agent-crew/bin/'], 'linux').changed, false);
});
test('rc block upsert is idempotent and replaces old blocks', () => {
  const b = P.rcBlock(['/h/.free-agent-crew/bin']);
  const t1 = P.upsertRcBlock('export X=1\n', b); const t2 = P.upsertRcBlock(t1, b);
  assert.strictEqual(t1, t2); assert.strictEqual(t1.split(P.RC_BEGIN).length, 2);
  const t3 = P.upsertRcBlock(t1, P.rcBlock(['/new'])); assert.match(t3, /\/new/); assert.doesNotMatch(t3, /free-agent-crew\/bin/);
  assert.match(P.rcBlock(['/a'], 'fish'), /set -gx PATH/);
});
test('rcFilesFor picks existing rc files, else shell default', () => {
  assert.deepStrictEqual(P.rcFilesFor('/h', { shellEnv: '/bin/zsh', plat: 'darwin', exists: () => false }), ['/h/.zshrc']);
  assert.deepStrictEqual(P.rcFilesFor('/h', { shellEnv: '/bin/bash', plat: 'linux', exists: (f) => f === '/h/.profile' }), ['/h/.profile', '/h/.bashrc']);
});
test('shims: absolute node path, no /usr/bin/env, UTF-8 code page on Windows, exit code propagated', () => {
  const sh = P.shimContents('sh', '/opt/node/bin/node', '/a/crew.js', ['exec', 'kilo']);
  assert.match(sh, /^#!\/bin\/sh/); assert.doesNotMatch(sh, /usr\/bin\/env/); assert.match(sh, /exec '\/opt\/node\/bin\/node' '\/a\/crew.js' 'exec' 'kilo' "\$@"/);
  const cmd = P.shimContents('cmd', 'C:\\node\\node.exe', 'C:\\app\\bin\\crew.js', []);
  assert.match(cmd, /chcp 65001/); assert.match(cmd, /"C:\\node\\node.exe" "C:\\app\\bin\\crew.js" %\*/); assert.match(cmd, /exit \/b %ERRORLEVEL%/); assert.match(cmd, /\r\n/);
  const ps1 = P.shimContents('ps1', 'C:\\node\\node.exe', 'C:\\app\\bin\\crew.js', ['exec', 'cline']);
  assert.match(ps1, /@args/); assert.match(ps1, /exit \$LASTEXITCODE/);
  assert.deepStrictEqual(P.shimFiles('crew', 'n', 'e', [], 'win32').map((x) => x[0]), ['crew.cmd', 'crew.ps1']);
  assert.deepStrictEqual(P.shimFiles('crew', 'n', 'e', [], 'linux').map((x) => x[0]), ['crew']);
  assert.ok(sh.includes(P.SHIM_MARK) && cmd.includes(P.SHIM_MARK) && ps1.includes(P.SHIM_MARK));
});
