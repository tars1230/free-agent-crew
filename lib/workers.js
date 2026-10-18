'use strict';
// Worker ("employee") definitions. Everything CLI-specific lives here; engine/models/crew are generic.
const fs = require('fs');
const path = require('path');
const U = require('./util');

const NET_RE = /ECONNRESET|ETIMEDOUT|socket hang up|ENOTFOUND|EAI_AGAIN|fetch failed|Unable to connect|ConnectionRefused|ECONNREFUSED|network error/i;
const AUTH_RE = /\b401\b|unauthori[sz]ed|not (logged|signed) in|please (log|sign) ?in|(login|session|token) (has )?expired|authentication (required|failed)|run [`'"]?cline auth/i;
const ISO_RE = /(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d))/g;

// Generic limit text (used on stderr, or anywhere when rc != 0). Matches quota errors and HTTP 429 wording.
const GENERIC_LIMIT = /(HTTP|status|code|error)[^0-9a-z\n]{0,5}429|429[: ]+(Too Many|rate)|FreeUsageLimitError|FreeTierError|Free usage exceeded|Rate limit exceeded|rate.?limit(ed)?[^a-z]|Too Many Requests|quota (exceeded|exhausted)|usage limit|free (tier|model) limit|insufficient_quota|RESOURCE_EXHAUSTED|额度|限流/i;

const WORKERS = {
  cline: {
    name: 'cline',
    bin: 'cline',
    npm: 'cline',
    account: '需要 Cline 账号（免费额度按账号、按模型、按天计）',
    quotaScope: 'account+model+day',
    url: 'https://api.cline.bot/api/v1/ai/cline/recommended-models',
    parseFree: (d) => (d && Array.isArray(d.free) ? d.free.map((x) => x && x.id).filter(Boolean) : []),
    builtin: ['cline-free/mimo-v2.6-flash'], // offline fallback: production-grade only (v1.3.6; step-5-preview left the free list, muse-spark is proxy-only)
    modelPrefix: 'cline-free/',
    limitRe: /free usage limit|Daily free model limit reached/i,
    // cline prints its limit error to stdout and still exits 0; with rc=0 only its own error line counts (model text may quote it).
    strongRe: /^[^ \n]*error:[^ \n]* Daily free model limit reached|"type": ?"error", ?"message": ?"Daily free model limit reached/m,
    strongOnStdout: true,
    cooldown: 'utc_midnight',
    totalTimeout: 3600,
    passthrough: ['--help', '-h', '--version', '-V', 'auth', 'config', 'version', 'help', 'update', 'mcp', 'history'],
    // headless task argv. NEVER -p: that is plan mode, not "prompt".
    taskArgs: ({ prompt, cwd, model }) => ['--auto-approve', 'true', ...(cwd ? ['-c', cwd] : []), '-m', model, prompt],
    needsActMode: true,
    keepTtyStdin: true,
    authCheck() {
      const p = path.join(U.home(), '.cline', 'data', 'settings', 'providers.json');
      const d = U.readJSON(p, null); // values are never printed
      if (!d) return { ok: false, why: `未找到 ${p}（从未登录）` };
      const c = d.providers && d.providers.cline;
      if (!c || !c.settings || !c.settings.auth) return { ok: false, why: 'providers.json 里没有 cline 账号登录信息' };
      return { ok: true, why: '已登录（检测到 cline provider 认证字段，未读取其值）' };
    },
    loginHint: '运行 `cline auth`（或 `cline` 进入后按提示登录 Cline 账号）；登录一次即可，之后 crew 全自动',
  },
  kilo: {
    name: 'kilo',
    bin: 'kilo',
    npm: '@kilocode/cli',
    account: '免费额度按 IP 每小时约 200 次请求，登录与否一样',
    quotaScope: 'ip+hour',
    url: 'https://api.kilo.ai/api/gateway/models',
    parseFree: (d) => {
      const EXCL = /^kilo-auto\/|^openrouter\/free$|content-safety|lyria|music|audio|tts|lfm-|embed|guard/i;
      return (d && Array.isArray(d.data) ? d.data : []).filter((x) => x && x.isFree && x.id && !EXCL.test(x.id)
        && ((x.architecture && x.architecture.output_modalities) || ['text']).includes('text')).map((x) => 'kilo/' + x.id);
    },
    builtin: [], // offline fallback: production-grade only (v1.3.6): no production-grade free kilo model on 2026-10-18 (step-5-preview / ling-3.1-flash are paid now)
    modelPrefix: 'kilo/',
    limitRe: GENERIC_LIMIT,
    strongRe: /FreeUsageLimitError|Rate limit exceeded|Too Many Requests/,
    strongOnStdout: false,
    cooldown: 'next_hour',
    totalTimeout: 1800,
    subcommand: 'run',
    // --auto: without it non-interactive kilo auto-REJECTS every permission, even reading files (hit during the 10-15 review).
    taskArgs: ({ prompt, cwd, model }) => ['run', '--auto', ...(cwd ? ['--dir', cwd] : []), '-m', model, prompt],
    authCheck: () => ({ ok: true, why: '不需要登录' }),
  },
  opencode: {
    name: 'opencode',
    bin: 'opencode',
    npm: 'opencode-ai',
    account: 'Zen 免费模型匿名可用，按出口 IP 共享限额（官方未公布具体数字）',
    quotaScope: 'ip+day',
    url: 'https://opencode.ai/zen/v1/models',
    parseFree: (d) => (d && Array.isArray(d.data) ? d.data : []).map((x) => x && x.id).filter((i) => i && (i.endsWith('-free') || i === 'big-pickle') && !i.startsWith('jev')).map((i) => 'opencode/' + i),
    cliModels: ['models', 'opencode'],
    builtin: ['opencode/deepseek-v4.1-flash-free', 'opencode/glm-5.3-flash-free', 'opencode/mimo-v2.6-flash-free'], // v1.3.6: production-grade only; // offline fallback: gate-passing, preferred first
    modelPrefix: 'opencode/',
    limitRe: /FreeUsageLimitError|FreeTierError|Rate limit exceeded|Free usage exceeded|Too Many Requests|rate.?limit(ed)?[^a-z]|quota exceeded|usage limit|(HTTP|status|code)[^0-9a-z\n]{0,5}429/i,
    strongRe: /FreeUsageLimitError|FreeTierError|Free usage exceeded/,
    strongOnStdout: false,
    cooldown: 'utc_midnight',
    totalTimeout: 1800,
    subcommand: 'run',
    variantArg: '--variant', // only opencode takes a reasoning variant (rank table preferred.variant)
    taskArgs: ({ prompt, cwd, model, variant }) => ['run', ...(cwd ? ['--dir', cwd] : []), '-m', model, ...(variant ? ['--variant', variant] : []), prompt],
    authCheck: () => ({ ok: true, why: '不需要登录' }),
  },
};
const ORDER = ['kilo', 'opencode', 'cline']; // default dispatch preference: cheapest quota first (cline is per-account/day)

// stdout of kilo/opencode carries model text: a strong marker there only counts on an error-looking line.
function outStrong(w) { return new RegExp(`^\\s*(([A-Za-z]+)?Error[\\]: ]|\\{"type": ?"error").*(${w.strongRe.source})`, 'm'); }

function workerList() { return Object.keys(WORKERS); }
function getWorker(n) {
  const w = WORKERS[String(n || '').toLowerCase().replace(/-auto$/, '')];
  if (!w) throw Object.assign(new Error(`未知员工: ${n}（可选: ${workerList().join(', ')}）`), { code: 64 });
  return w;
}

// cline rejects prompts that are entirely Chinese with full-width punctuation: give it an ASCII frame and ASCII punctuation.
const FW = { '，': ', ', '。': '. ', '：': ': ', '；': '; ', '！': '! ', '？': '? ', '（': ' (', '）': ') ', '“': '"', '”': '"', '‘': "'", '’': "'", '、': ', ', '【': '[', '】': ']', '《': '<', '》': '>', '…': '...', '—': '-', '～': '~' };
function sanitizeForCline(p) {
  p = String(p);
  const hasLatin = /[A-Za-z]{3,}/.test(p);
  const out = p.replace(/[，。：；！？（）“”‘’、【】《》…—～]/g, (c) => FW[c]);
  return hasLatin && out === p ? p : `Task (the user writes in Chinese; reply in Chinese):\n${out}`;
}

module.exports = { WORKERS, ORDER, NET_RE, AUTH_RE, ISO_RE, GENERIC_LIMIT, outStrong, workerList, getWorker, sanitizeForCline };
