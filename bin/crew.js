#!/usr/bin/env node
'use strict';
// free-agent-crew CLI. Usage: crew help
const fs = require('fs');
const path = require('path');
const U = require('../lib/util');

const HELP = `crew — 派发免费模型员工（cline / kilo / opencode），自动换模型、换员工

用法:
  crew doctor [--live] [--json] [--quick]   体检（agent 每次先跑这个）
  crew ask <任务>                           交给第一个有额度的员工；额度没了自动换下一个
  crew review <要审的内容或文件说明>        多员工并行只读复核 + 自动合并成一份结论
  crew brainstorm <主题>                    多员工并行脑暴 + 去重排序
  crew relay <任务>                         接力：起草 -> 挑错改进 -> 定稿（不同员工）
  crew cross <任务>                         一个员工做，其余员工互审它的结果
  crew run <员工> <任务>                    指定员工（带模型自动切换）
  crew exec <员工> [原生参数...]            与原生 CLI 参数一致 + 自动切换（cline-auto/kilo-auto/opencode-auto 即此）
  crew status [--json]                      各员工可用模型 / 冷却到何时
  crew models <员工> [--refresh]            免费模型名单、能力分与门槛（MODEL_MIN_SCORE，默认 60）
  crew reset <员工> [模型]                  清除冷却记录
  crew setup [--no-cli] [--no-path] [--no-skills] [--upgrade] [--registry URL] [--force] [--tray] [--uninstall-tray]
  crew quota [员工...] [--json]   今日调用/成功率/首选模型/冷却/门槛（红黄绿；只读本机记录，不联网）
  crew quota --line                一行状态，给 waybar/polybar/tmux 等状态栏用
  crew tray [install|uninstall|status]   状态栏/托盘（macOS 菜单栏、Windows 通知区域；默认不装）
  crew version

通用选项:
  --workers kilo,opencode   只用这些员工（顺序即优先级）     --n 3        并行人数上限
  --cwd DIR                 工作目录（默认当前目录）         --timeout S  每个员工总时限（秒）
  --model kilo=xxx,cline=yyy 指定首选模型                    --write      允许员工改文件（默认只读）
  --no-synth                不做汇总合并                       --json       输出 JSON
  --file F                  从文件读任务；任务写 "-" 则从 stdin 读

退出码: 0 成功 | 75 所有免费额度暂时用尽（等恢复时间）| 124 超时 | 127 CLI 未安装 | 77 需要登录 | 64 用法错误 | 其他=员工 CLI 原始退出码`;

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw Object.assign(new Error(`${a} 需要参数`), { code: 64 }); return v; };
    if (a === '--') { o._.push(...argv.slice(i + 1)); break; }
    else if (['--workers', '--cwd', '--model', '--file', '--registry'].includes(a)) o[a.slice(2)] = val();
    else if (a === '--n') o.n = +val();
    else if (a === '--timeout') o.timeout = +val();
    else if (/^--(workers|cwd|model|file|registry|n|timeout)=/.test(a)) { const [k, v] = a.slice(2).split(/=(.*)/s); o[k] = ['n', 'timeout'].includes(k) ? +v : v; }
    else if (a === '--no-synth') o.synth = false;
    else if (['--json', '--write', '--live', '--quick', '--refresh', '--no-cli', '--no-path', '--no-skills', '--upgrade', '--force', '--tray', '--uninstall-tray', '--line'].includes(a)) o[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = true;
    else o._.push(a);
  }
  return o;
}

async function readTask(o) {
  if (o.file) return fs.readFileSync(o.file, 'utf8');
  if (o._.length === 1 && o._[0] === '-') { const b = await require('../lib/engine').readStdinSafe({ firstMs: 5000 }); return b ? b.toString('utf8') : ''; }
  return o._.join(' ');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return 0; }
  if (cmd === 'version' || cmd === '--version') { console.log(require('../package.json').version); return 0; }
  if (cmd === 'exec') { // raw passthrough: do not parse crew options
    const [w, ...args] = rest; if (!w) { console.error('crew exec <员工> [参数...]'); return 64; }
    return require('../lib/engine').execRaw(w, args);
  }
  const o = parse(rest);
  if (o.cwd) o.cwd = path.resolve(o.cwd); else o.cwd = process.cwd();
  if (cmd === 'doctor') { const r = await require('../lib/doctor').doctor(o); console.log(r.text); return r.code; }
  if (cmd === 'setup') return require('../lib/setup').setup(o);
  const W = require('../lib/workers'); const M = require('../lib/models'); const E = require('../lib/engine');
  if (cmd === 'quota') {
    const Q = require('../lib/quota'); const d = await Q.quota(o._.length ? o._.map((n) => W.getWorker(n).name) : undefined);
    console.log(o.json ? JSON.stringify(d, null, 1) : o.line ? Q.line(d) : Q.render(d)); return 0;
  }
  if (cmd === 'tray') {
    const T = require('../lib/tray'); const sub = o._[0] || 'status';
    if (sub === 'status') { const s = T.status(); console.log(s.installed ? '已安装: ' + s.files.join(' ') : '未安装（crew tray install）'); return 0; }
    if (!['install', 'uninstall'].includes(sub)) { console.error('crew tray [install|uninstall|status]'); return 64; }
    const r = sub === 'install' ? T.install() : T.uninstall(); r.msgs.forEach((m) => console.log(m)); return r.ok ? 0 : 1;
  }
  if (cmd === 'status' || cmd === 'models') {
    const names = o._.length ? o._ : W.workerList(); const out = [];
    for (const n of names) {
      const w = W.getWorker(n); const bin = E.resolveBin(w);
      const pl = await M.plan(w, { refresh: !!o.refresh, bin: cmd === 'models' ? bin : null });
      const t = M.rankTable(w);
      out.push({ worker: w.name, installed: !!bin, login: w.authCheck(), src: pl.src, models: pl.all.map((m) => ({ model: m, score: M.scoreOf(m, t), inTable: !!t[m], provisional: (pl.provisional || []).includes(m), coolingUntil: (pl.skipped.find((s) => s.model === m) || {}).until || null })), excluded: (pl.excluded || []).map((d) => ({ model: d.model, score: d.score, reason: d.reason })) });
    }
    if (o.json) { console.log(JSON.stringify(out, null, 1)); return 0; }
    for (const x of out) {
      console.log(`\n${x.worker}  ${x.installed ? '已安装' : '未安装'}  ${x.login.ok ? '' : '未登录  '}名单来源=${x.src}`);
      for (const m of x.models) console.log(`  ${m.coolingUntil ? '⏳' : '✅'} ${m.model.padEnd(48)} ${String(m.score).padStart(5)}${m.provisional ? ' (试用期，无评测)' : m.inTable ? '' : ' (启发式)'}${m.coolingUntil ? '  冷却到 ' + U.fmtReset(m.coolingUntil) : ''}`);
      for (const m of x.excluded) console.log(`  ⛔ ${m.model.padEnd(48)} ${String(m.score).padStart(5)} 门槛排除 ${m.reason}`);
    }
    return 0;
  }
  if (cmd === 'reset') { const w = W.getWorker(o._[0]); M.clearExhausted(w, o._[1]); console.log(`已清除 ${w.name} ${o._[1] || '全部'} 的冷却记录`); return 0; }
  if (cmd === 'run') {
    const [wn, ...t] = o._; const w = W.getWorker(wn);
    const task = await readTask({ ...o, _: t });
    if (!task.trim()) { console.error('crew run <员工> <任务>'); return 64; }
    const r = await E.runTask(w.name, task, { cwd: o.cwd, model: require('../lib/crew').modelFor(o, w.name) || (o.model && !o.model.includes('=') ? o.model : ''), readonly: !o.write, totalTimeout: o.timeout });
    if (o.json) console.log(JSON.stringify({ worker: r.worker, rc: r.rc, model: r.model, ms: r.ms, tried: r.tried, message: r.message, text: r.text }, null, 1));
    else { if (r.text) console.log(r.text); if (r.message) console.error(r.message); else if (r.rc !== 0) console.error(U.stripAnsi(r.err).trim().split('\n').slice(-5).join('\n')); }
    return r.rc;
  }
  if (['ask', 'review', 'brainstorm', 'relay', 'cross'].includes(cmd)) {
    const task = await readTask(o);
    if (!task.trim()) { console.error(`crew ${cmd} <任务>   （或 --file F，或 "-" 从 stdin 读）`); return 64; }
    const r = await require('../lib/crew').dispatch(cmd, task, o);
    console.log(o.json ? JSON.stringify({ ...r.summary, final: (r.out.synthesis || r.out.final || {}).text || null, outputs: r.out.results.filter((x) => x.text).map((x) => ({ worker: x.worker, role: x.role, text: x.text })) }, null, 1) : r.text);
    return r.summary.code;
  }
  console.error(`未知命令 ${cmd}\n\n${HELP}`); return 64;
}

main().then((c) => { process.exitCode = typeof c === 'number' ? c : 0; }, (e) => { console.error('crew: ' + (e && e.message || e)); process.exitCode = e && Number.isInteger(e.code) ? e.code : 1; });
