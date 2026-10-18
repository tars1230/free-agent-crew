# free-agent-crew

把三个免费模型编程 CLI（**cline / kilo / opencode**）变成总控 agent（WorkBuddy、Claude Code、Codex、Hermes……）可直接派活的“员工团队”：
自动发现免费模型 → 按能力排序 → 额度/429 自动换模型、换员工 → 记录冷却 → 汇总结果。单一 Node.js 实现，macOS / Linux / Windows 通用，零 npm 依赖。

## 三步上手
1. **拿到 zip 并安装**：`free-agent-crew-1.3.5.zip` 可以来自 GitHub Release（私有仓库，要先 `gh auth login`，再运行 `gh release download -R tars1230/free-agent-crew -p 'free-agent-crew-[0-9]*.zip'` 下载最新版）、网盘，或别人直接发给你。解压到 Downloads 后运行（命令见下方「一句话安装」）：macOS / Linux 用 `sh ~/Downloads/free-agent-crew/install.sh`，Windows 用 `powershell -ExecutionPolicy Bypass -File $HOME\Downloads\free-agent-crew\install.ps1`。要状态栏或托盘就加 `--tray`。国内网络先看 [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) 设置代理或镜像。
2. **登录 cline（只要一次）**：新开一个终端，运行 `cline auth`，在浏览器登录 Cline 账号（免费注册）。kilo 和 opencode 不用登录。然后运行 `crew doctor`，“需要你做的事”为空就好了。
3. **让总控 agent 派活**：安装器已经把 skill 装进本机已有的 Claude Code / Codex / WorkBuddy 等技能目录，直接对总控 agent 说“用 free-agent-crew 让免费员工复核 src/x.ts”即可；可复制的派单模板在 [prompts/](prompts/README.md)。想看谁还有额度：运行 `crew quota`。

出问题：先运行 `crew doctor`，再看 [skill 故障排查](skills/free-agent-crew/references/troubleshooting.md) 和 [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)。

## 三个板块

| 板块 | 目录 | 用途 | 入口 |
|---|---|---|---|
| 工具 / 安装包 | `bin/` `lib/` `install.sh` `install.ps1` `data/` `test/` | `crew` 命令本体：调度、额度切换、能力门槛、体检、跨平台安装 | 下载 `free-agent-crew-1.3.5.zip` → 运行安装脚本（见下） |
| Skill | `skills/free-agent-crew/`（`SKILL.md` + `references/`） | 让 Claude Code、Codex、WorkBuddy/CodeBuddy、Hermes、opencode、cline、kilo 等 agent 知道何时、怎样派活给 `crew` | 安装脚本自动装到各 agent 的技能目录；只装 skill：解压 `free-agent-crew-skill-1.3.4.zip` 到技能目录 |
| 提示词 | `prompts/` | 给总控 agent 直接复制的派单模板：新设备安装、单员工、互审、脑暴、接力、做-审分离 | 打开 [`prompts/README.md`](prompts/README.md) |

其他：`docs/RULES.md` 复核票与派活规则（正式复核票顺序、kilo 不计票、不用 codex、Opus 只在点名时用）；`docs/REQUIREMENTS.md` 下载来源、注册登录、网络要求与离线安装；`docs/TRAY.md` 托盘；`docs/BLINDSPOTS.md` 盲区清单；`extras/` 可选组件（不随安装脚本安装）；`CHANGELOG.md` 版本记录；`LICENSE`（MIT）。

## 一句话安装
macOS / Linux：
```sh
unzip -o free-agent-crew-1.3.5.zip -d ~/Downloads && sh ~/Downloads/free-agent-crew/install.sh
```
Windows（PowerShell）：
```powershell
Expand-Archive -Force free-agent-crew-1.3.5.zip $HOME\Downloads; powershell -ExecutionPolicy Bypass -File $HOME\Downloads\free-agent-crew\install.ps1
```
安装器是幂等的，重复运行=修复/升级。参数：`--no-cli`（不装三个 CLI）`--no-path` `--no-skills` `--upgrade`（升级 CLI）`--registry URL`（也可设环境变量 `CREW_NPM_REGISTRY`）`--force`（覆盖同名技能）`--tray` / `--uninstall-tray`。Node 下载镜像用 `CREW_NODE_MIRROR`，代理用 `HTTPS_PROXY`，详见 [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)。

安装后只剩一件人工的事：**cline 需要登录一次**（`cline auth`，需要 Cline 账号，可免费注册）。kilo、opencode 免登录。`crew doctor` 会把要做的事列清楚。

## 它做了什么
| 步骤 | 说明 |
|---|---|
| Node | 找 Node ≥ 18（PATH、Homebrew、nvm、volta、Program Files）；没有就 brew/winget，再不行下载官方便携 Node 22 到 `~/.free-agent-crew/node`（nodejs.org 失败回落 npmmirror，SHA256 校验） |
| 三个 CLI | `npm i -g cline @kilocode/cli opencode-ai`；全局目录不可写自动改用 `~/.free-agent-crew/npm-global`（不用 sudo）；官方源失败回落 `registry.npmmirror.com` |
| 自动更新/遥测 | 没有配置时新建 `opencode.json`/`kilo.json`（autoupdate=false, share=disabled）；已有 JSONC 不改；运行时总是注入 `DO_NOT_TRACK=1`、`OPENCODE_DISABLE_AUTOUPDATE=1`、`KILO_DISABLE_AUTOUPDATE=1` 等 |
| 命令 | `~/.free-agent-crew/bin/` 下生成 `crew`、`crew-cline/kilo/opencode`，以及 `cline-auto/kilo-auto/opencode-auto`（若 PATH 上已有别人的同名命令则不生成，不覆盖）。Windows 生成 `.cmd` + `.ps1` |
| PATH | Linux/mac：在 `.zshrc/.bashrc/.bash_profile/.profile`（和 fish conf.d）写入带标记的块，可重复运行；Windows：写用户 PATH（PowerShell API，不用会截断的 setx） |
| 技能 | 整个 `skills/free-agent-crew/`（`SKILL.md` + `references/`）装到 `~/.free-agent-crew/skill/free-agent-crew/`，并装进**已存在**的 `~/.claude/skills`、`~/.codex/skills`、`~/.workbuddy/skills`、`~/.codebuddy/skills`、`~/.hermes/skills`、`~/.agents/skills`、`~/.config/opencode/skills`、`~/.cline/skills`、`~/.kilo/skills`；文档里的 `{{CREW_ABS}}` 等占位换成本机绝对路径；同名但非 crew 的技能不覆盖（`--force` 才覆盖） |

不依赖 PATH 的调用：`"<node 绝对路径>" ~/.free-agent-crew/app/bin/crew.js doctor`（doctor 第一行会打印本机的准确命令）。

## 用法
```sh
crew doctor [--live] [--quick] # 体检；--live 会让每个员工真答一句 PONG（耗 1 次额度）；--quick 跳过版本探测与联网取名单（安装器末尾用）
crew ask "问题"                # 第一个有额度的员工回答，额度没了自动换下一个
crew review "复核 src/x.ts"    # 并行只读复核 + 合并共识（VERDICT: PASS/FAIL）；审查员默认 opencode→cline→kilo，kilo 只作参考不计票（docs/RULES.md）
crew brainstorm "主题"         # 并行脑暴 + 去重排序
crew relay "任务"              # 起草 -> 挑错改进 -> 定稿，三个不同员工接力
crew cross "任务" --write      # 一人做，其余人互审
crew run kilo "任务"           # 指定员工
crew status / models / reset   # 额度与冷却
crew quota [--json|--line]     # 今日调用/成功率/首选模型/冷却恢复/门槛统计/kilo 本小时调用，红黄绿灰（只读本机记录，不耗额度）
crew tray install|uninstall|status   # 可选状态栏/托盘（见 docs/TRAY.md）；安装时加 --tray，卸载 --uninstall-tray
cline-auto|kilo-auto|opencode-auto ...   # 与原 CLI 参数一致 + 自动换模型（= crew exec <员工> ...）
```
通用选项：`--workers kilo,opencode` `--n 3` `--cwd DIR` `--timeout S` `--model kilo=xxx` `--write` `--no-synth` `--json` `--file F`。

### 退出码
`0` 成功 · `75` 达标的免费模型额度全部暂时用尽，或没有模型达到能力门槛（输出里写明恢复时间和被门槛排除的模型）· `78` 判断类调用（复核/验收等）没有可用的生产级模型（v1.3.4，不会退到弱模型）· `124` 总时限/无输出超时 · `127` CLI 未安装 · `77` 需要登录 · `64` 用法错误 · 其它=员工 CLI 原始码。

## 免费模型怎么来的
1. 实时名单（3 秒超时）：cline `api.cline.bot/.../recommended-models` 的 `free`；kilo `api.kilo.ai/api/gateway/models` 的 `isFree`（排除音乐/TTS/审核/嵌入等非文本模型）；opencode `opencode.ai/zen/v1/models` 的 `*-free` 与 `big-pickle`，并与本机 `opencode models opencode` 取交集。
2. 1 小时缓存 → 过期缓存 → 内置名单（离线也能跑）。
3. 能力分与门槛（v1.1.0）：`score = 2 × Artificial Analysis Intelligence Index v4.3.x`。默认门槛 `MODEL_MIN_SCORE=60`（即 AA ≥ 30），并要求 agentic 下限：AA 测的 Terminal-Bench 4.0 ≥ 10%（`MODEL_MIN_TB`），没有 TB 数据时 AA Agentic Index ≥ 15（`MODEL_MIN_AGENTIC`）。低于门槛的模型不进轮换；`--model` 显式指定的不受限；`MODEL_MIN_SCORE=0` 临时放宽。
   - 依据优先级：`data/*-model-rank.json`（2026-10-16 重建，v1.3.2 起与现网表对齐，每条都写了来源和日期，用户可在 `~/.free-agent-crew/config/` 覆盖）→ OpenRouter 公开 `/api/v1/models` 里的 AA 指数（无需 key，24 小时缓存，拉取失败用过期缓存，再不行只用排名表）→ 试用期估分。
   - 新模型（没有评测）= 试用期：按同家族上一代实测分加不超过 10 分的溢价、付费版旗舰价（≥$2/M 输出 +5）、名字档位估分，最高 79；估分 ≥ 门槛−10（`MODEL_PROVISIONAL_SLACK`）才能进轮换，且永远排在所有达标模型之后；`MODEL_PROVISIONAL=0` 可关掉试用期。设了 `AGENT_EVENTS_LOG` 时，按近 14 天本机成功率：≥5 次且 ≥80% 转正，<50% 降 15 分。
   - `crew models` 显示每个模型的分数，标注“试用期”和“门槛排除”及原因。
   - 排名表的 `_note` 里提到的 `~/.shared/lib/model_gate.py` 是参考实现（现网包装器用的那份）；crew 里对应的是 `lib/gate.js`（门槛）和 `lib/region.js`（地区屏蔽）。内置表与现网表逐字节一致，方便直接同步。
   - `data/subscription-model-rank.json`：cursor-agent / agy 等订阅模型的实测分，**不参与** cline/kilo/opencode 的轮换，供 model-discover 和复核票分级（见 [docs/RULES.md](docs/RULES.md)）用。
4. 地区屏蔽（v1.3.3，对齐现网 cline-auto v3.6 / opencode-auto v1.3+）：模型报“not available in your region”之类的地区限制时不重试，立刻换下一个模型，并记入 `~/.free-agent-crew/config/region-blocked-models.json`（`MODEL_REGION_BLOCK_FILE` 可改），7 天内自动选择都跳过（`MODEL_REGION_RETRY_DAYS`）；到期后由一次真实调用复查（`MODEL_REGION_PROBE_HOLD` 秒内防并发重复复查），成功即移除。`--model` 指定的不跳过。地区限制是厂商政策，不要用代理绕过；手工解除删掉对应条目即可。`crew quota` 会列出被屏蔽的模型。判定比现网包装器略严：命中的行还必须像报错，crew 自己的标识和文件名不算，避免模型正文/工具输出里的文件名误触发。

5. 判断类调用只用生产级（v1.3.4，对齐现网 opencode-auto / cline-auto / kilo-auto 的 judgement-gate）：`crew review`、`crew cross` 的审查员和 review 汇总，以及环境变量 `AUTO_JUDGEMENT=1`（或 `CREW_JUDGEMENT=1`）、`AGENT_CALLER` / `AGENT_TASK` / `AGENT_ROLE` 含 review、verify、accept、audit、supervision、复核、验收、判断、裁决等词的调用，只在生产级模型（过门槛且 evidence 为 measured/openrouter_aa，按全部排名表、固定 baseline 判定）之间选择和切换；`--model` 指定弱模型也会被丢弃。候选里没有生产级 → 退出码 78 并写日志（`judgement_gate` / `judgement_no_prod`），不会退到弱模型；生产级都用尽 → 75。其它调用不变，kilo 照常干活。

6. 规划器 30 秒封顶（v1.3.5，对齐现网三个包装器的 timeout-hardening）：取模型名单 / 排序超过 `CREW_PLAN_TIMEOUT` 秒（默认 30）就按规划失败处理，回落到内置名单；判断类调用回落后仍只用生产级。

### 首选模型 `preferred`（v1.3.2；v1.3.3 起 `--model` 时也置顶）
排名表顶层可以有一个 `preferred` 块，只调顺序、不改分（内置的 opencode 表已带一份：首选 deepseek-v4.1-flash-free（max 档），glm-5.3-flash-free 兜底）：
```json
"preferred": {
  "order": ["opencode/deepseek-v4.1-flash-free", "opencode/glm-5.3-flash-free"],
  "fallback_on_error": ["opencode/deepseek-v4.1-flash-free"],
  "variant": { "opencode/deepseek-v4.1-flash-free": "max" }
}
```
- `order`：先过门槛，再把 `order` 里**已达标**的模型按顺序放到最前；被门槛排除、或不在今天免费名单里的不置顶。用 `--model` 指定时顺序是：指定的模型 → 置顶模型 → 其余（与现网 opencode-auto v1.4 一致）；用 `CREW_<员工>_FREE_MODELS` 手写名单时不生效。日志记 `preferred_pin=...`。离线内置名单（v1.3.3）只收能过门槛的模型，opencode 以首选模型开头。
- `fallback_on_error`：这些模型报**任何错**（不只是额度；登录错误、超时除外）都换下一个模型，日志记 `pinned_error`，事件 `switch reason=pinned_error`。`--model` 显式指定的模型不受影响。
- `variant`：只对 opencode 生效，给该模型加 `--variant <值>`（值只允许字母、数字和 `_ . -`）；你自己在 `opencode-auto` 参数里写了 `--variant` 时不再追加。
- 覆盖与回滚：在 `~/.free-agent-crew/config/opencode-model-rank.json` 里写自己的 `preferred` 会**整块替换**内置的那份；写 `"preferred": {}` 即关闭。（与现网的有意差异：现网 opencode-auto 只读一份表，crew 是内置表 + 用户表。）

### 可选组件：`extras/model-discover`（v4）
每天比对 cline / kilo / opencode 的免费名单、cursor-agent（`--list-models`）和 agy（`models`）的订阅模型名单，以及 OpenRouter 的上游新快照，把新模型/未排名模型写进待评测队列并留告警，从不改排名表。不在安装脚本默认流程里，需要时按 [extras/model-discover/README.md](extras/model-discover/README.md) 手动装（macOS launchd 模板、Linux cron 示例；Windows 暂不提供）。

## 额度与冷却
- 识别：各 CLI 自己的额度错误、HTTP 429、Too Many Requests、FreeUsageLimitError 等。cline 额度错误打在 stdout 且退出码 0，所以 rc=0 时只认 cline 自己的错误行；kilo/opencode stdout 里只认“错误样式”的行，模型正文里引用这些字眼不会误判。
- 运行中一出现额度错误就杀掉该次运行（有的 CLI 报错后会挂住），同一时刻既命中额度又到总时限时按额度处理。
- 恢复时间：只认**未来**的时间戳（日志里的 `"ts"` 过去时间不算）→ “try again in 5h 29m” → retry-after → 默认（cline/opencode 到下一个 UTC 0 点；kilo 到下一个整点）。
- 状态文件 `~/.free-agent-crew/state/*-quota-state.json`：mkdir 锁 + 临时文件原子替换；损坏/非对象/时钟回拨产生的记录自动忽略。

## 额度面板与托盘（v1.3.1）
- 每次调用都写事件到 `~/.free-agent-crew/logs/events.jsonl`（可用 `CREW_EVENTS_LOG` 改位置）：一行一个 JSON，字段 `ts agent caller session_id model event rc duration tokens run`（与常见 agent-events.jsonl 格式一致，**不记录任务内容**）；`crew quota` 只读这些记录和冷却状态。
- 颜色：🟢 有达标模型可用 · 🟡 达标模型都在冷却只剩试用期模型（或门槛模块出错）· 🔴 没有可用模型 · ⚪ 没数据（未安装/从没用过）。kilo 的“本小时调用”按调用次数计，限额按请求数算，只是下限参考。
- 托盘：macOS 菜单栏（本机 swiftc 编译，已实测）；Windows 通知区域（PowerShell + .NET NotifyIcon，启动文件夹自启，**未在 Windows 实机测试**）；Linux 不装常驻程序，给 waybar/polybar/i3blocks/tmux/GNOME 接 `crew quota --line` 的示例（**未实机测试**）。详见 `docs/TRAY.md`。

## 盲区清单（都已处理）
见 `docs/BLINDSPOTS.md`。

## 测试
```sh
npm test                    # node:test，83 个用例：判断类调用只用生产级/地区屏蔽/复核计票/离线内置名单过门槛/首选模型置顶/fallback_on_error/opencode --variant、自定义 npm 目录查找/额度面板各颜色与计数/事件记录/macOS 托盘真实编译并沙箱运行/假 CLI 覆盖切换/75/124/77/127/stdin/act 模式/并发锁/Windows shim 与 PATH 逻辑/skill 结构与安装/能力门槛（排除、试用期排序、评测拉取失败回落、--model 绕过）
sh test/docker-linux.sh     # 有 docker 时在一次性容器里跑测试和安装
```

## 已知限制
- 免费额度规则由各厂商随时调整；正则与默认冷却按 2026-10 的行为写成，可用环境变量 `CREW_<员工>_FREE_MODELS`、`CREW_<员工>_URL` 覆盖。
- `KILO_DISABLE_AUTOUPDATE` 是按 opencode 分叉惯例设置的，未在 kilo 官方文档中确认；kilo 的 JSONC 配置不会被改。
- 员工默认只读是“提示词约束”，不是沙箱；`--write` 才明确允许改文件。
