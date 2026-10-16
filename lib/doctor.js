'use strict';
// crew doctor: item-by-item health check with a concrete fix for every problem, and a "你需要做的事" list.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const U = require('./util');
const P = require('./platform');
const W = require('./workers');
const M = require('./models');
const E = require('./engine');

function sh(cmd, args, timeout = 15000) {
  try {
    const bin = P.which(cmd) || cmd; const sp = P.resolveSpawn(bin);
    const r = cp.spawnSync(sp.cmd, [...sp.pre, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, env: E.childEnv(), shell: sp.shell, windowsHide: true });
    return { rc: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), timedOut: r.error && r.error.code === 'ETIMEDOUT' };
  } catch (e) { return { rc: -1, out: '', err: e.message }; }
}

async function doctor({ live = false, json = false, quick = false } = {}) {
  const items = []; const todo = [];
  const add = (level, name, detail, fix) => { items.push({ level, name, detail, fix }); if (fix && level !== 'ok') todo.push(`${name}: ${fix}`); };

  // 1. node
  const nv = process.versions.node.split('.').map(Number);
  if (nv[0] < 18) add('fail', 'Node.js', `v${process.versions.node} 太旧（需要 >= 18，cline/kilo/opencode 也需要较新 Node）`, '重新运行 install.sh / install.ps1，它会在用户目录装一个便携 Node 22');
  else add(nv[0] < 20 ? 'warn' : 'ok', 'Node.js', `v${process.versions.node} @ ${process.execPath}`, nv[0] < 20 ? '建议升级到 Node 20+（部分 CLI 新版本要求）' : '');

  // 2. npm + global prefix writable + registry
  const npm = P.which('npm');
  if (!npm) add('fail', 'npm', '找不到 npm', '安装 Node 时会自带 npm；重跑安装脚本');
  else {
    const pre = sh('npm', ['prefix', '-g']);
    let writable = false; const gdir = pre.out ? (U.IS_WIN ? pre.out : path.join(pre.out, 'lib')) : '';
    try { fs.accessSync(gdir, fs.constants.W_OK); writable = true; } catch (_) {}
    add(writable ? 'ok' : 'warn', 'npm 全局目录', `${pre.out || '?'}${writable ? ' 可写' : ' 不可写'}`, writable ? '' : 'crew setup 会自动改用用户目录前缀 ~/.free-agent-crew/npm-global（无需 sudo）');
    const reg = sh('npm', ['config', 'get', 'registry']).out;
    let regOk = false; try { await M.fetchJSON(String(reg || 'https://registry.npmjs.org/').replace(/\/?$/, '/') + 'cline/latest', 4000); regOk = true; } catch (_) {}
    add(regOk ? 'ok' : 'warn', 'npm 源', `${reg}${regOk ? ' 可达' : ' 不可达/超时'}`, regOk ? '' : 'crew setup 安装失败时会自动回落到 https://registry.npmmirror.com；也可设置 HTTPS_PROXY');
  }

  // 3. PATH / commands
  const bdir = U.binDir();
  const onPath = String(process.env[P.pathKey()] || '').split(P.pathSep()).some((d) => path.resolve(d) === path.resolve(bdir));
  const crewEntry = path.join(U.PKG_ROOT, 'bin', 'crew.js');
  add(onPath ? 'ok' : 'warn', 'PATH', onPath ? `${bdir} 在 PATH 中` : `${bdir} 不在当前 PATH（新开终端才会生效，或安装还没做）`,
    onPath ? '' : `新开一个终端；或不依赖 PATH 直接调用: "${process.execPath}" "${crewEntry}" <命令>`);
  for (const n of ['crew', 'cline-auto', 'kilo-auto', 'opencode-auto']) {
    const f = P.which(n);
    if (!f) continue;
    const ours = P.isOurShim(f) || P.isOurShim(f.replace(/\.(cmd|ps1)$/i, '') + '.cmd');
    if (!ours && n !== 'crew') add('info', `命令 ${n}`, `PATH 上的 ${n} 是 ${f}（不是 crew 生成的，crew 不会覆盖）`, '');
  }
  const envBin = P.which('env');
  if (!U.IS_WIN && envBin && !['/usr/bin/env', '/bin/env'].includes(envBin)) add('warn', 'env 遮蔽', `PATH 上第一个 env 是 ${envBin}，会让 "#!/usr/bin/env node" 类脚本异常`, 'crew 的 shim 直接用绝对路径调 node，不受影响；如别的工具异常，把该目录从 PATH 前面移走');

  // 4. workers
  for (const n of W.workerList()) {
    const w = W.getWorker(n);
    const bin = E.resolveBin(w);
    if (!bin) { add('fail', `员工 ${n}`, '未安装', `运行 crew setup（或 npm i -g ${w.npm}）`); continue; }
    const v = quick ? { rc: 0, out: '(skipped)' } : sh(bin, ['--version'], 30000);
    add(v.rc === 0 ? 'ok' : 'warn', `员工 ${n}`, `${bin}  版本 ${(v.out || v.err).split('\n').pop()}${v.timedOut ? '（--version 超时，可能卡在首次运行向导）' : ''}`, v.rc === 0 ? '' : `手动运行一次 \`${w.bin} --version\` 看是否有首次运行提示`);
    const a = w.authCheck();
    add(a.ok ? 'ok' : 'fail', `${n} 登录`, `${a.why}；${w.account}`, a.ok ? '' : w.loginHint);
    try {
      const pl = await M.plan(w, { bin: quick ? null : bin });
      const lvl = pl.avail.length ? (pl.src === 'builtin' ? 'warn' : 'ok') : 'warn';
      const nx = pl.skipped.length ? `；冷却中 ${pl.skipped.length} 个（最早 ${U.fmtReset(Math.min(...pl.skipped.map((s) => s.until)))} 恢复）` : '';
      add(lvl, `${n} 免费模型`, `来源=${pl.src} 共 ${pl.all.length} 个，可用 ${pl.avail.length} 个，首选 ${pl.avail[0] || '-'}${nx}${(pl.excluded || []).length ? `；门槛排除 ${pl.excluded.length} 个` : ''}${(pl.provisional || []).length ? `；试用期 ${pl.provisional.length} 个` : ''}`,
        pl.src === 'builtin' ? '实时名单拉取失败（离线/被墙），已用内置名单；检查网络或设置 HTTPS_PROXY' : (pl.avail.length ? '' : '全部冷却中：等恢复，crew 会自动用别的员工'));
      const unk = pl.info.filter((i) => i.startsWith('rank_unknown')).length;
      if (unk) add('info', `${n} 排名`, `${unk} 个新模型不在排名表里，已按名字/家族启发式打分自动参与排序`, '');
    } catch (e) { add('warn', `${n} 免费模型`, '规划失败: ' + e.message, '会回落到内置名单'); }
    if (n === 'cline') {
      const gs = path.join(U.home(), '.cline', 'data', 'settings', 'global-settings.json');
      const d = U.readJSON(gs, null);
      if (d && d.planActMode === 'plan') add('info', 'cline 模式', '全局 planActMode=plan；crew 运行时会临时切到 act（引用计数，结束自动恢复）', '');
    }
  }
  // auto-update configs
  for (const [n, dir] of [['opencode', 'opencode'], ['kilo', 'kilo']]) {
    const base = path.join(U.home(), '.config', dir);
    const f = ['opencode.json', 'opencode.jsonc', 'kilo.json', 'kilo.jsonc', 'config.json'].map((x) => path.join(base, x)).find((x) => fs.existsSync(x));
    const txt = f ? fs.readFileSync(f, 'utf8') : '';
    const off = /"autoupdate"\s*:\s*false/.test(txt);
    add(off ? 'ok' : 'info', `${n} 自动更新`, off ? `已在 ${f} 关闭` : 'crew 调用时用环境变量关闭（*_DISABLE_AUTOUPDATE=1、DO_NOT_TRACK=1）', off ? '' : '');
  }

  // 5. state files, locks, clock, proxy
  for (const n of W.workerList()) {
    const p = M.statePath(W.getWorker(n));
    if (fs.existsSync(p) && U.readJSON(p, '__bad__') === '__bad__') add('warn', `${n} 状态文件`, `${p} 损坏`, '不影响运行（会当成空状态并在下次写入时重建）；可用 crew reset ' + n);
    if (fs.existsSync(p + '.lockdir')) add('info', `${n} 锁`, '存在锁目录（若无运行中的 crew 会在 30 秒后自动视为过期）', '');
  }
  try {
    const t0 = Date.now(); const { date } = await M.fetchJSON(W.WORKERS.cline.url, 3000);
    if (date) { const skew = Math.round((Date.parse(date) - (t0 + Date.now()) / 2) / 1000); add(Math.abs(skew) > 300 ? 'warn' : 'ok', '系统时钟', `与服务器相差 ${skew}s；时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone}`, Math.abs(skew) > 300 ? '打开系统自动对时（冷却时间按 UTC 计算，时钟偏差会导致过早/过晚重试）' : ''); }
  } catch (_) { add('warn', '网络', '访问 api.cline.bot 失败（3 秒超时）', '离线时仍可用内置名单；国内网络建议设置 HTTPS_PROXY'); }
  const prox = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY'].filter((k) => process.env[k] || process.env[k.toLowerCase()]);
  add('info', '代理', prox.length ? `已设置: ${prox.join(', ')}（只显示变量名）` : '未设置代理变量', '');
  if (U.IS_WIN) add('info', 'Windows', '不需要 bash；crew/*.cmd/*.ps1 shim 直接调用 node', 'PowerShell 若提示脚本被禁止，用 crew.cmd 或执行 Set-ExecutionPolicy -Scope CurrentUser RemoteSigned');

  if (live) {
    for (const n of W.workerList()) {
      const w = W.getWorker(n);
      if (!E.resolveBin(w) || !w.authCheck().ok) continue;
      const r = await E.runTask(n, 'Reply with exactly the word: PONG', { totalTimeout: 180 });
      add(r.rc === 0 && /PONG/i.test(r.text) ? 'ok' : r.rc === 75 ? 'warn' : 'fail', `${n} 实测`, `rc=${r.rc} model=${r.model || '-'} ${Math.round(r.ms / 1000)}s ${r.rc === 0 ? '' : (r.message || '').slice(0, 200)}`, r.rc === 0 ? '' : r.rc === 75 ? '额度用尽，等恢复' : '查看日志 ' + path.join(U.logDir(), n + '.log'));
    }
  }
  const fails = items.filter((i) => i.level === 'fail').length;
  if (json) return { code: fails ? 1 : 0, text: JSON.stringify({ items, todo, crewHome: U.crewHome(), entry: crewEntry, node: process.execPath }, null, 1) };
  const icon = { ok: '✅', warn: '⚠️ ', fail: '❌', info: 'ℹ️ ' };
  const L = ['free-agent-crew doctor', `CREW_HOME=${U.crewHome()}`, `绝对路径调用（不依赖 PATH）: "${process.execPath}" "${crewEntry}"`, ''];
  for (const i of items) L.push(`${icon[i.level]} ${i.name}: ${i.detail}${i.fix && i.level !== 'ok' ? `\n     → ${i.fix}` : ''}`);
  L.push('', todo.length ? '需要你做的事:\n' + todo.map((t, k) => `  ${k + 1}. ${t}`).join('\n') : '需要你做的事: 无，可以直接派活。');
  return { code: fails ? 1 : 0, text: L.join('\n') };
}
module.exports = { doctor };
