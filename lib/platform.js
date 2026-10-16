'use strict';
// Platform layer: PATH lookup, Windows .cmd handling, shim generation, PATH/rc editing. Pure functions are exported for tests.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const U = require('./util');

function pathSep(plat = process.platform) { return plat === 'win32' ? ';' : ':'; }
function pathKey(env = process.env) { return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH'; }

// which(): returns the first executable named `name` on PATH (honours PATHEXT on Windows). `skipDirs` excludes our own shim dir.
function which(name, { env = process.env, plat = process.platform, skipDirs = [], all = false, exists = fileExists } = {}) {
  const dirs = String(env[pathKey(env)] || '').split(pathSep(plat)).filter(Boolean);
  const exts = plat === 'win32' ? ['', ...String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';').filter(Boolean)] : [''];
  const P = plat === 'win32' ? path.win32 : path.posix;
  const norm = (d) => P.resolve(d).toLowerCase();
  const skip = new Set(skipDirs.map(norm));
  const hits = [];
  for (const d of dirs) {
    if (skip.has(norm(d))) continue;
    for (const e of exts) {
      if (plat === 'win32' && e === '' && !/\.[a-z0-9]+$/i.test(name)) continue;
      const f = P.join(d, name + e);
      if (exists(f, plat)) { if (!all) return f; hits.push(f); break; }
    }
  }
  return all ? hits : null;
}
function fileExists(f, plat) {
  try { const st = fs.statSync(f); if (!st.isFile()) return false; if (plat !== 'win32') fs.accessSync(f, fs.constants.X_OK); return true; } catch (_) { return false; }
}

// Windows: Node >= 18.20/20.12 refuses to spawn .cmd/.bat without a shell (CVE-2024-27980). npm's shims are .cmd,
// so we read the shim and run the JS entry with node directly (no cmd.exe quoting problems for Chinese / quotes).
function parseNpmCmdShim(text, shimPath) {
  // npm cmd-shim line: "%_prog%"  "%dp0%\node_modules\cline\bin\cline" %*   (or "%dp0%\..\lib\...")
  const m = text.match(/"%dp0%\\([^"]+?)"\s+%\*/i) || text.match(/"%~dp0\\([^"]+?)"\s+%\*/i);
  if (!m) return null;
  const rel = m[1];
  const target = path.win32.join(path.win32.dirname(shimPath), rel);
  return { target, viaNode: /%_prog%|node(\.exe)?"/i.test(text) || /\.(c|m)?js$/i.test(rel) || !/\.exe$/i.test(rel) };
}
function resolveSpawn(bin, { plat = process.platform, read = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  if (plat === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    try {
      const r = parseNpmCmdShim(read(bin), bin);
      if (r) return r.viaNode ? { cmd: process.execPath, pre: [r.target], shell: false } : { cmd: r.target, pre: [], shell: false };
    } catch (_) {}
    return { cmd: bin, pre: [], shell: true }; // last resort; args are quoted by quoteCmdArg
  }
  return { cmd: bin, pre: [], shell: false };
}
// cmd.exe argument quoting (only used for the shell:true last resort).
function quoteCmdArg(a) {
  a = String(a);
  if (a && !/[\s"&|<>^%!()]/.test(a)) return a;
  a = a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return ('"' + a + '"').replace(/([()%!^"<>&|])/g, '^$1');
}

function mergePathList(existing, add, plat = process.platform) {
  const sep = pathSep(plat);
  const parts = String(existing || '').split(sep).filter(Boolean);
  const key = (d) => (plat === 'win32' ? d.replace(/[\\/]+$/, '').toLowerCase() : d.replace(/\/+$/, ''));
  const have = new Set(parts.map(key));
  const front = [];
  for (const d of [].concat(add)) if (!have.has(key(d))) { front.push(d); have.add(key(d)); }
  return { value: [...front, ...parts].join(sep), changed: front.length > 0 };
}

const RC_BEGIN = '# >>> free-agent-crew >>>';
const RC_END = '# <<< free-agent-crew <<<';
function rcBlock(dirs, shell = 'sh') {
  if (shell === 'fish') return `${RC_BEGIN}\nfor d in ${dirs.map((d) => `"${d}"`).join(' ')}\n  contains $d $PATH; or set -gx PATH $d $PATH\nend\n${RC_END}\n`;
  const lines = dirs.map((d) => `case ":$PATH:" in *":${d}:"*) ;; *) PATH="${d}:$PATH" ;; esac`);
  return `${RC_BEGIN}\n${lines.join('\n')}\nexport PATH\n${RC_END}\n`;
}
// Idempotent: replaces an existing block, otherwise appends. Returns new text.
function upsertRcBlock(text, block) {
  text = text || '';
  const re = new RegExp(`${RC_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${RC_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`);
  if (re.test(text)) return text.replace(re, block);
  return text + (text && !text.endsWith('\n') ? '\n' : '') + '\n' + block;
}
function rcFilesFor(homeDir, { shellEnv = process.env.SHELL || '', plat = process.platform, exists = (f) => fs.existsSync(f) } = {}) {
  const P = path.posix;
  const files = [];
  const cand = ['.zshrc', '.bashrc', '.bash_profile', '.profile'];
  for (const f of cand) if (exists(P.join(homeDir, f))) files.push(P.join(homeDir, f));
  if (/zsh/.test(shellEnv) && !files.some((f) => f.endsWith('.zshrc'))) files.push(P.join(homeDir, '.zshrc'));
  if (/bash/.test(shellEnv) && !files.some((f) => /\.bash(rc|_profile)$/.test(f))) files.push(P.join(homeDir, plat === 'darwin' ? '.bash_profile' : '.bashrc'));
  if (!files.length) files.push(P.join(homeDir, '.profile'));
  const fish = P.join(homeDir, '.config', 'fish');
  if (exists(fish)) files.push(P.join(fish, 'conf.d', 'free-agent-crew.fish'));
  return files;
}

// Shims call node by ABSOLUTE path: no `#!/usr/bin/env node` (a stray ~/.local/bin/env can shadow /usr/bin/env), no PATH dependency.
const SHIM_ENV = { DO_NOT_TRACK: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', KILO_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_SHARE: '1', KILO_DISABLE_SHARE: '1' };
// single-quote literals: sh closes/escapes/reopens ('\''), PowerShell doubles ('')
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
function shimContents(kind, nodePath, entry, preArgs = []) {
  const pre = preArgs.map((a) => (kind === 'sh' ? ` ${shq(a)}` : kind === 'ps1' ? ` ${psq(a)}` : ` "${a}"`)).join('');
  if (kind === 'sh') return `#!/bin/sh\n# free-agent-crew shim (generated; safe to delete)\nexec ${shq(nodePath)} ${shq(entry)}${pre} "$@"\n`;
  if (kind === 'cmd') return `@echo off\r\nrem free-agent-crew shim (generated)\r\nsetlocal\r\nchcp 65001 >nul 2>&1\r\n"${nodePath}" "${entry}"${pre} %*\r\nexit /b %ERRORLEVEL%\r\n`;
  if (kind === 'ps1') return `# free-agent-crew shim (generated)\r\n[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\r\n& ${psq(nodePath)} ${psq(entry)}${pre} @args\r\nexit $LASTEXITCODE\r\n`;
  throw new Error('unknown shim kind ' + kind);
}
function shimFiles(name, nodePath, entry, preArgs, plat = process.platform) {
  if (plat === 'win32') return [[name + '.cmd', shimContents('cmd', nodePath, entry, preArgs)], [name + '.ps1', shimContents('ps1', nodePath, entry, preArgs)]];
  return [[name, shimContents('sh', nodePath, entry, preArgs)]];
}
const SHIM_MARK = 'free-agent-crew shim';
function isOurShim(f) { try { return fs.readFileSync(f, 'utf8').includes(SHIM_MARK); } catch (_) { return false; } }

// Windows user PATH via PowerShell (no setx: setx truncates at 1024 chars).
function winGetUserPath() {
  const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  return r.status === 0 ? r.stdout.trim() : null;
}
function winSetUserPath(v) {
  const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', `[Environment]::SetEnvironmentVariable('Path', $env:CREW_NEWPATH, 'User')`], { env: { ...process.env, CREW_NEWPATH: v }, stdio: 'ignore', timeout: 20000 });
  return r.status === 0;
}

// Kill a whole process tree (no orphaned node/bun children left behind).
function killTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { cp.spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10000 }); } catch (_) {}
    return;
  }
  try { process.kill(-child.pid, signal); } catch (_) { try { child.kill(signal); } catch (_) {} }
}

module.exports = { pathSep, pathKey, which, parseNpmCmdShim, resolveSpawn, quoteCmdArg, mergePathList, rcBlock, upsertRcBlock,
  rcFilesFor, shimContents, shimFiles, isOurShim, SHIM_ENV, SHIM_MARK, winGetUserPath, winSetUserPath, killTree, RC_BEGIN, RC_END };
