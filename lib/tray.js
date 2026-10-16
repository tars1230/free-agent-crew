'use strict';
// Optional status-bar/tray view of `crew quota` (default: not installed). No third-party software:
//   macOS  : tiny AppKit menu-bar app compiled locally with swiftc (Xcode Command Line Tools) + per-user LaunchAgent.
//   Windows: PowerShell + .NET NotifyIcon script, started hidden from a Startup-folder shortcut.
//   Linux  : no daemon; status-bar snippets (waybar/polybar/i3blocks/GNOME) in docs/TRAY.md use `crew quota --line`.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const U = require('./util');

const LABEL = 'io.github.free-agent-crew.quota';
const trayDir = () => path.join(U.crewHome(), 'tray');
const src = (...p) => path.join(U.PKG_ROOT, 'tray', ...p);
const noLaunch = () => process.env.CREW_TRAY_NO_LAUNCH === '1'; // tests: build/write files but never start or register anything
const run = (cmd, args, o = {}) => cp.spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, ...o });
function writeCfg(nodePath, entry) { U.mkdirp(trayDir()); U.writeJSONAtomic(path.join(trayDir(), 'tray.json'), { node: nodePath, entry, path: process.env.PATH || '' }); }
// tray.json.path = PATH at install time: launchd gives GUI apps a bare PATH, so the CLIs would look uninstalled

// ---- macOS ----
const macApp = () => path.join(trayDir(), 'CrewQuota.app');
const macBin = () => path.join(macApp(), 'Contents', 'MacOS', 'CrewQuota');
const macPlist = () => path.join(U.home(), 'Library', 'LaunchAgents', LABEL + '.plist');
function swiftc() {
  const r = run('xcrun', ['--find', 'swiftc'], { timeout: 20000 });
  // run through `xcrun swiftc` so the SDK is resolved (the bare toolchain binary can't find the stdlib on its own)
  if (r.status === 0 && r.stdout.trim()) return ['xcrun', 'swiftc'];
  const w = run('/bin/sh', ['-c', 'command -v swiftc'], { timeout: 5000 });
  return w.status === 0 && w.stdout.trim() ? [w.stdout.trim()] : null;
}
function macBuild(out = macApp()) {
  const sc = swiftc(); if (!sc) return { ok: false, msg: '未找到 swiftc（需要 Xcode 命令行工具：xcode-select --install），已跳过状态栏程序' };
  const tmp = out + '.new'; fs.rmSync(tmp, { recursive: true, force: true });
  U.mkdirp(path.join(tmp, 'Contents', 'MacOS'));
  fs.copyFileSync(src('macos', 'Info.plist'), path.join(tmp, 'Contents', 'Info.plist'));
  const r = run(sc[0], [...sc.slice(1), '-O', '-framework', 'AppKit', src('macos', 'main.swift'), '-o', path.join(tmp, 'Contents', 'MacOS', 'CrewQuota')]);
  if (r.status !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, msg: 'swiftc 编译失败：' + (r.stderr || '').trim().split('\n').slice(-3).join(' ') }; }
  run('codesign', ['--force', '--sign', '-', tmp], { timeout: 60000 }); // ad-hoc; ignore failure (still runs locally)
  fs.rmSync(out, { recursive: true, force: true }); fs.renameSync(tmp, out);
  return { ok: true, msg: '已编译 ' + out };
}
function plistXml() {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>${LABEL}</string>\n  <key>ProgramArguments</key><array><string>${esc(macBin())}</string></array>\n  <key>EnvironmentVariables</key><dict><key>CREW_HOME</key><string>${esc(U.crewHome())}</string></dict>\n  <key>RunAtLoad</key><true/>\n  <key>ProcessType</key><string>Interactive</string>\n</dict>\n</plist>\n`;
}
const uid = () => (process.getuid ? process.getuid() : 0);
function macInstall(nodePath, entry) {
  const msgs = []; writeCfg(nodePath, entry);
  const b = macBuild(); msgs.push(b.msg); if (!b.ok) return { ok: false, msgs };
  U.mkdirp(path.dirname(macPlist())); fs.writeFileSync(macPlist(), plistXml()); msgs.push('登录自启 -> ' + macPlist());
  if (noLaunch()) { msgs.push('（CREW_TRAY_NO_LAUNCH=1：未启动）'); return { ok: true, msgs }; }
  run('launchctl', ['bootout', `gui/${uid()}/${LABEL}`], { timeout: 20000 }); // re-run = restart with the new build
  let r; // bootout finishes asynchronously; retry bootstrap briefly instead of failing a re-install
  for (let i = 0; i < 5; i++) { r = run('launchctl', ['bootstrap', `gui/${uid()}`, macPlist()], { timeout: 20000 }); if (r.status === 0) break; cp.spawnSync('/bin/sleep', ['1']); }
  msgs.push(r.status === 0 ? '已启动：菜单栏出现三个圆点（cline kilo opencode）' : '注册失败（' + (r.stderr || '').trim() + '），可手动 open ' + macApp());
  return { ok: r.status === 0, msgs };
}
function macUninstall() {
  const msgs = [];
  if (!noLaunch()) run('launchctl', ['bootout', `gui/${uid()}/${LABEL}`], { timeout: 20000 });
  for (const p of [macPlist(), macApp(), path.join(trayDir(), 'tray.json')]) if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); msgs.push('已删除 ' + p); }
  if (!msgs.length) msgs.push('状态栏程序未安装');
  return { ok: true, msgs };
}

// ---- Windows ----
const winScript = () => path.join(trayDir(), 'crew-tray.ps1');
const startupDir = () => path.join(process.env.APPDATA || path.join(U.home(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const winLnk = () => path.join(startupDir(), 'free-agent-crew tray.lnk');
const psArgs = () => `-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "${winScript()}"`;
function ps(command, env = {}) { return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { env: { ...process.env, ...env }, timeout: 60000, windowsHide: true }); }
function winInstall(nodePath, entry) {
  const msgs = []; writeCfg(nodePath, entry);
  // overwriting the script also retires an already-running old instance (it watches its own mtime)
  fs.copyFileSync(src('windows', 'crew-tray.ps1'), winScript()); msgs.push('托盘脚本 -> ' + winScript());
  if (noLaunch()) { msgs.push('（CREW_TRAY_NO_LAUNCH=1：未创建快捷方式、未启动）'); return { ok: true, msgs }; }
  // values travel via env vars, never spliced into the command text
  const mk = ps('$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:CREW_LNK); $s.TargetPath="powershell.exe"; $s.Arguments=$env:CREW_ARGS; $s.WindowStyle=7; $s.Description="free-agent-crew quota tray"; $s.Save()',
    { CREW_LNK: winLnk(), CREW_ARGS: psArgs() });
  msgs.push(mk.status === 0 ? '登录自启 -> ' + winLnk() : '创建启动快捷方式失败：' + (mk.stderr || '').trim());
  try { // start directly (no intermediate PowerShell, no quoting issues with spaces in the user name)
    cp.spawn('powershell.exe', ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', winScript()], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    msgs.push('已启动：通知区域出现三个圆点（可能在 ^ 折叠区）');
  } catch (e) { msgs.push('启动失败：' + e.message); }
  return { ok: mk.status === 0, msgs };
}
function winUninstall() {
  const msgs = [];
  for (const p of [winLnk(), winScript(), path.join(trayDir(), 'tray.json')]) if (fs.existsSync(p)) { fs.rmSync(p, { force: true }); msgs.push('已删除 ' + p); }
  msgs.push(msgs.length ? '正在运行的托盘会在 1 分钟内发现脚本已删除并自行退出' : '托盘未安装');
  return { ok: true, msgs };
}

function install(nodePath = process.execPath, entry = path.join(U.PKG_ROOT, 'bin', 'crew.js'), plat = process.platform) {
  if (plat === 'darwin') return macInstall(nodePath, entry);
  if (plat === 'win32') return winInstall(nodePath, entry);
  return { ok: false, msgs: ['Linux 不安装常驻程序：按 docs/TRAY.md 把 `crew quota --line` 接到 waybar/polybar/i3blocks/GNOME 扩展，或 `watch -n 60 crew quota`'] };
}
function uninstall(plat = process.platform) {
  if (plat === 'darwin') return macUninstall();
  if (plat === 'win32') return winUninstall();
  return { ok: true, msgs: ['Linux 没有安装常驻程序，无需卸载（删掉状态栏配置里的 crew quota 模块即可）'] };
}
function status(plat = process.platform) {
  if (plat === 'darwin') return { installed: fs.existsSync(macPlist()) && fs.existsSync(macBin()), files: [macPlist(), macApp()] };
  if (plat === 'win32') return { installed: fs.existsSync(winLnk()) && fs.existsSync(winScript()), files: [winLnk(), winScript()] };
  return { installed: false, files: [] };
}
module.exports = { LABEL, install, uninstall, status, macBuild, plistXml, swiftc, trayDir };
