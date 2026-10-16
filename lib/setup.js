'use strict';
// crew setup: idempotent installer core (called by install.sh / install.ps1, or directly). All logic in Node -> one implementation for every OS.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const U = require('./util');
const P = require('./platform');
const W = require('./workers');
const E = require('./engine');

const MIRROR = 'https://registry.npmmirror.com';
function say(s) { process.stdout.write(s + '\n'); }

function npmCmd() { return P.which('npm') || P.which('npm', { env: { PATH: path.dirname(process.execPath) } }); }
function npm(args, { timeout = 15 * 60 * 1000, extraEnv = {} } = {}) {
  const bin = npmCmd(); if (!bin) return { rc: 127, out: '', err: 'npm not found' };
  const sp = P.resolveSpawn(bin);
  const r = cp.spawnSync(sp.cmd, [...sp.pre, ...args].map((a) => (sp.shell ? P.quoteCmdArg(a) : a)), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, shell: sp.shell, windowsHide: true,
    env: { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false', ...extraEnv } });
  return { rc: r.status === null ? 124 : r.status, out: r.stdout || '', err: (r.stderr || '') + (r.error ? r.error.message : '') };
}
function globalWritable() {
  const pre = npm(['prefix', '-g'], { timeout: 30000 }).out.trim(); if (!pre) return { pre, ok: false };
  const d = U.IS_WIN ? pre : path.join(pre, 'lib');
  try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return { pre, ok: true }; } catch (_) { return { pre, ok: false }; }
}
function userPrefix() { return path.join(U.crewHome(), 'npm-global'); }
function userPrefixBin() { return U.IS_WIN ? userPrefix() : path.join(userPrefix(), 'bin'); }

function installCli(w, { registry } = {}) {
  const g = globalWritable();
  const base = ['install', '-g', w.npm + '@latest'];
  const pref = g.ok ? [] : ['--prefix', userPrefix()];
  if (!g.ok) say(`  npm 全局目录 ${g.pre || '?'} 不可写 -> 改装到用户目录 ${userPrefix()}（不需要 sudo）`);
  const regs = registry ? [registry] : [null, MIRROR];
  for (const reg of regs) {
    say(`  npm ${[...base, ...pref].join(' ')}${reg ? ' --registry=' + reg : ''}`);
    const r = npm([...base, ...pref, ...(reg ? ['--registry', reg] : [])], { timeout: reg ? 15 * 60e3 : 6 * 60e3 });
    if (r.rc === 0) return { ok: true, userPrefix: !g.ok };
    const tail = r.err.split('\n').filter(Boolean).slice(-3).join(' | ');
    say(`  失败 rc=${r.rc}: ${tail.slice(0, 300)}`);
    if (/EACCES|EPERM/.test(r.err) && g.ok) { // writable test lied (e.g. root-owned subdir): retry into user prefix
      const r2 = npm([...base, '--prefix', userPrefix(), ...(reg ? ['--registry', reg] : [])]);
      if (r2.rc === 0) return { ok: true, userPrefix: true };
    }
    if (!reg) say('  -> 回落到国内镜像 ' + MIRROR);
  }
  return { ok: false };
}

// Disable auto-update/share in CLI configs only when that is safe (no config yet, or plain JSON). JSONC is never rewritten.
function disableAutoUpdate(dirName, base) {
  const dir = path.join(U.home(), '.config', dirName);
  const json = path.join(dir, `${base}.json`); const jsonc = path.join(dir, `${base}.jsonc`);
  if (fs.existsSync(jsonc)) return `${jsonc} 是 JSONC，未改动（运行时用环境变量关闭自动更新）`;
  if (!fs.existsSync(json)) { U.writeJSONAtomic(json, { $schema: dirName === 'kilo' ? undefined : 'https://opencode.ai/config.json', autoupdate: false, share: 'disabled' }); return `新建 ${json}（autoupdate=false, share=disabled）`; }
  const d = U.readJSON(json, null);
  if (!d || typeof d !== 'object') return `${json} 无法解析，未改动`;
  if (d.autoupdate === false) return `${json} 已关闭自动更新`;
  fs.copyFileSync(json, json + '.bak-crew'); d.autoupdate = false; if (d.share === undefined) d.share = 'disabled';
  U.writeJSONAtomic(json, d); return `已在 ${json} 设置 autoupdate=false（备份 .bak-crew）`;
}

function writeShims(nodePath, entry) {
  const dir = U.mkdirp(U.binDir()); const made = []; const skipped = [];
  const want = [['crew', []]];
  for (const n of W.workerList()) { want.push([`crew-${n}`, ['exec', n]]); want.push([`${n}-auto`, ['exec', n]]); }
  for (const [name, pre] of want) {
    if (name.endsWith('-auto')) { // never shadow a user's own *-auto command
      const other = P.which(name, { skipDirs: [dir] }) || (U.IS_WIN ? P.which(name + '.cmd', { skipDirs: [dir] }) : null);
      if (other && !P.isOurShim(other)) { skipped.push(`${name}（已存在 ${other}，改用 crew-${name.replace(/-auto$/, '')}）`); continue; }
    }
    for (const [fname, body] of P.shimFiles(name, nodePath, entry, pre)) {
      const f = path.join(dir, fname);
      if (fs.existsSync(f) && !P.isOurShim(f)) { skipped.push(`${f}（不是 crew 生成的，未覆盖）`); continue; }
      fs.writeFileSync(f, body); if (!U.IS_WIN) fs.chmodSync(f, 0o755); made.push(fname);
    }
  }
  return { dir, made, skipped };
}

function configurePath(dirs) {
  if (U.IS_WIN) {
    const cur = P.winGetUserPath(); if (cur === null) return ['读取用户 PATH 失败，请手动把 ' + dirs.join(';') + ' 加入用户 PATH'];
    const m = P.mergePathList(cur, dirs, 'win32');
    if (!m.changed) return ['用户 PATH 已包含 crew 目录'];
    return [P.winSetUserPath(m.value) ? '已写入用户 PATH（新开终端生效）' : '写入用户 PATH 失败，请手动添加 ' + dirs.join(';')];
  }
  const msgs = [];
  for (const f of P.rcFilesFor(U.home())) {
    const fish = f.endsWith('.fish');
    const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    const neu = fish ? P.rcBlock(dirs, 'fish') : P.upsertRcBlock(old, P.rcBlock(dirs));
    if (neu === old) { msgs.push(`${f} 已配置`); continue; }
    U.mkdirp(path.dirname(f)); fs.writeFileSync(f, neu); msgs.push(`已更新 ${f}`);
  }
  return msgs;
}

// Global skill dirs of common agents (installed only where the agent's home already exists).
const SKILL_HOMES = [['.claude', 'skills'], ['.codex', 'skills'], ['.workbuddy', 'skills'], ['.codebuddy', 'skills'], ['.hermes', 'skills'],
  ['.agents', 'skills'], ['.config/opencode', 'skills'], ['.cline', 'skills'], ['.kilo', 'skills']];
const SKILL_SRC = path.join(U.PKG_ROOT, 'skills', 'free-agent-crew');
function skillFiles(dir = SKILL_SRC, rel = '') { // [relativePath, ...] of the skill dir (SKILL.md + references/ ...)
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) out.push(...skillFiles(dir, r)); else if (e.isFile() && e.name !== '.DS_Store') out.push(r);
  }
  return out;
}
function installSkill(nodePath, entry, { force = false, targets } = {}) {
  const abs = `"${nodePath}" "${entry}"`;
  const fill = (t) => t.split('{{CREW_ABS}}').join(abs).split('{{CREW_HOME}}').join(U.crewHome());
  const files = skillFiles().map((r) => [r, fs.readFileSync(path.join(SKILL_SRC, r), 'utf8')]);
  const out = [];
  const dests = [path.join(U.crewHome(), 'skill', 'free-agent-crew')];
  for (const [h, s] of SKILL_HOMES) { const base = path.join(U.home(), h); if (targets ? targets.includes(path.basename(h).replace(/^\./, '')) : fs.existsSync(base)) dests.push(path.join(base, s, 'free-agent-crew')); }
  for (const d of dests) {
    const f = path.join(d, 'SKILL.md');
    if (fs.existsSync(f) && !fs.readFileSync(f, 'utf8').includes('free-agent-crew-skill') && !force) { out.push(`跳过 ${f}（已有同名非 crew 技能）`); continue; }
    for (const [r, t] of files) { const g = path.join(d, r); U.mkdirp(path.dirname(g)); fs.writeFileSync(g, r.endsWith('.md') ? fill(t) : t); }
    out.push(`技能 -> ${d}（${files.length} 个文件）`);
  }
  return out;
}

async function setup(opt = {}) {
  const nodePath = process.execPath; const entry = path.join(U.PKG_ROOT, 'bin', 'crew.js');
  say(`free-agent-crew setup  (node ${process.versions.node}, ${process.platform}/${process.arch})`);
  if (+process.versions.node.split('.')[0] < 18) { say('❌ Node 版本过低（需要 >= 18），请用 install.sh / install.ps1（会自动装便携 Node）'); return 1; }
  [U.crewHome(), U.stateDir(), U.logDir(), U.configDir()].forEach(U.mkdirp);
  let usedPrefix = fs.existsSync(userPrefixBin());
  if (!opt.noCli && process.env.CREW_SKIP_CLI_INSTALL !== '1') {
    say('\n[1/5] 检查员工 CLI');
    for (const n of W.workerList()) {
      const w = W.getWorker(n); const b = E.resolveBin(w);
      if (b && !opt.upgrade) { say(`  ✅ ${n}: ${b}`); continue; }
      say(`  安装 ${n} (${w.npm}) ...`);
      const r = installCli(w, { registry: opt.registry });
      if (r.userPrefix) usedPrefix = true;
      say(r.ok ? `  ✅ ${n} 安装完成` : `  ❌ ${n} 安装失败：稍后手动 npm i -g ${w.npm}（或设置 HTTPS_PROXY 后重跑安装）`);
    }
  } else say('\n[1/5] 跳过 CLI 安装（--no-cli）');
  say('\n[2/5] 关闭自动更新/分享');
  say('  ' + disableAutoUpdate('opencode', 'opencode')); say('  ' + disableAutoUpdate('kilo', 'kilo'));
  say('  运行时另加环境变量: ' + Object.keys(P.SHIM_ENV).join(', '));
  say('\n[3/5] 生成命令 shim');
  const s = writeShims(nodePath, entry);
  say(`  ${s.dir}: ${s.made.join(' ')}`); s.skipped.forEach((x) => say('  跳过 ' + x));
  say('\n[4/5] 配置 PATH');
  const nodeDir = path.dirname(nodePath);
  const real = (d) => { try { return fs.realpathSync(d); } catch (_) { return path.resolve(d); } };
  const ownNode = real(nodeDir).startsWith(real(U.crewHome()) + path.sep); // portable node: put it (and its npm CLIs) on PATH too
  const dirs = [s.dir, ...(usedPrefix ? [userPrefixBin()] : []), ...(ownNode ? [nodeDir] : [])];
  if (opt.noPath) say('  跳过（--no-path）'); else configurePath(dirs).forEach((m) => say('  ' + m));
  say('\n[5/5] 安装 SKILL.md');
  if (opt.noSkills) say('  跳过（--no-skills）'); else installSkill(nodePath, entry, { force: opt.force }).forEach((m) => say('  ' + m));
  if (opt.uninstallTray) { say('\n[托盘] 卸载'); require('./tray').uninstall().msgs.forEach((m) => say('  ' + m)); }
  else if (opt.tray) { say('\n[托盘] 安装状态栏/托盘程序'); require('./tray').install(nodePath, entry).msgs.forEach((m) => say('  ' + m)); }
  for (const n of W.workerList()) { // rank tables the user may edit (package defaults stay as fallback)
    const f = path.join(U.configDir(), `${n}-model-rank.json`);
    if (!fs.existsSync(f)) fs.copyFileSync(path.join(U.PKG_ROOT, 'data', `${n}-model-rank.json`), f);
  }
  say(`\n完成。新开终端后可直接用 crew；不依赖 PATH 的调用: "${nodePath}" "${entry}" doctor`);
  say('下一步: crew doctor');
  return 0;
}
module.exports = { setup, writeShims, configurePath, installSkill, disableAutoUpdate, installCli, MIRROR };
