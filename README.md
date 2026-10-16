# free-agent-crew

把三个免费模型编程 CLI（**cline / kilo / opencode**）变成总控 agent（WorkBuddy、Claude Code、Codex、Hermes……）可直接派活的“员工团队”：
自动发现免费模型 → 按能力排序 → 额度/429 自动换模型、换员工 → 记录冷却 → 汇总结果。单一 Node.js 实现，macOS / Linux / Windows 通用，零 npm 依赖。

## 一句话安装
macOS / Linux：
```sh
unzip -o free-agent-crew-1.1.0.zip -d ~/Downloads && sh ~/Downloads/free-agent-crew/install.sh
```
Windows（PowerShell）：
```powershell
Expand-Archive -Force free-agent-crew-1.1.0.zip $HOME\Downloads; powershell -ExecutionPolicy Bypass -File $HOME\Downloads\free-agent-crew\install.ps1
```
安装器是幂等的，重复运行=修复/升级。参数：`--no-cli`（不装三个 CLI）`--no-path` `--no-skills` `--upgrade`（升级 CLI）`--registry URL` `--force`（覆盖同名技能）。

安装后只剩一件人工的事：**cline 需要登录一次**（`cline auth`）。kilo、opencode 免登录。`crew doctor` 会把要做的事列清楚。

## 它做了什么
| 步骤 | 说明 |
|---|---|
| Node | 找 Node ≥ 18（PATH、Homebrew、nvm、volta、Program Files）；没有就 brew/winget，再不行下载官方便携 Node 22 到 `~/.free-agent-crew/node`（nodejs.org 失败回落 npmmirror，SHA256 校验） |
| 三个 CLI | `npm i -g cline @kilocode/cli opencode-ai`；全局目录不可写自动改用 `~/.free-agent-crew/npm-global`（不用 sudo）；官方源失败回落 `registry.npmmirror.com` |
| 自动更新/遥测 | 没有配置时新建 `opencode.json`/`kilo.json`（autoupdate=false, share=disabled）；已有 JSONC 不改；运行时总是注入 `DO_NOT_TRACK=1`、`OPENCODE_DISABLE_AUTOUPDATE=1`、`KILO_DISABLE_AUTOUPDATE=1` 等 |
| 命令 | `~/.free-agent-crew/bin/` 下生成 `crew`、`crew-cline/kilo/opencode`，以及 `cline-auto/kilo-auto/opencode-auto`（若 PATH 上已有别人的同名命令则不生成，不覆盖）。Windows 生成 `.cmd` + `.ps1` |
| PATH | Linux/mac：在 `.zshrc/.bashrc/.bash_profile/.profile`（和 fish conf.d）写入带标记的块，可重复运行；Windows：写用户 PATH（PowerShell API，不用会截断的 setx） |
| 技能 | `SKILL.md` 装到 `~/.free-agent-crew/skill/`，并装进已存在的 `~/.claude/skills`、`~/.codex/skills`、`~/.workbuddy/skills`、`~/.hermes/skills`、`~/.agents/skills`、`~/.config/opencode/skills`；SKILL 内写入了本机绝对路径调用方式 |

不依赖 PATH 的调用：`"<node 绝对路径>" ~/.free-agent-crew/app/bin/crew.js doctor`（doctor 第一行会打印本机的准确命令）。

## 用法
```sh
crew doctor [--live] [--quick] # 体检；--live 会让每个员工真答一句 PONG（耗 1 次额度）；--quick 跳过版本探测与联网取名单（安装器末尾用）
crew ask "问题"                # 第一个有额度的员工回答，额度没了自动换下一个
crew review "复核 src/x.ts"    # 并行只读复核 + 合并共识（VERDICT: PASS/FAIL）
crew brainstorm "主题"         # 并行脑暴 + 去重排序
crew relay "任务"              # 起草 -> 挑错改进 -> 定稿，三个不同员工接力
crew cross "任务" --write      # 一人做，其余人互审
crew run kilo "任务"           # 指定员工
crew status / models / reset   # 额度与冷却
cline-auto|kilo-auto|opencode-auto ...   # 与原 CLI 参数一致 + 自动换模型（= crew exec <员工> ...）
```
通用选项：`--workers kilo,opencode` `--n 3` `--cwd DIR` `--timeout S` `--model kilo=xxx` `--write` `--no-synth` `--json` `--file F`。

### 退出码
`0` 成功 · `75` 达标的免费模型额度全部暂时用尽，或没有模型达到能力门槛（输出里写明恢复时间和被门槛排除的模型）· `124` 总时限/无输出超时 · `127` CLI 未安装 · `77` 需要登录 · `64` 用法错误 · 其它=员工 CLI 原始码。

## 免费模型怎么来的
1. 实时名单（3 秒超时）：cline `api.cline.bot/.../recommended-models` 的 `free`；kilo `api.kilo.ai/api/gateway/models` 的 `isFree`（排除音乐/TTS/审核/嵌入等非文本模型）；opencode `opencode.ai/zen/v1/models` 的 `*-free` 与 `big-pickle`，并与本机 `opencode models opencode` 取交集。
2. 1 小时缓存 → 过期缓存 → 内置名单（离线也能跑）。
3. 能力分与门槛（v1.1.0）：`score = 2 × Artificial Analysis Intelligence Index v4.3.x`。默认门槛 `MODEL_MIN_SCORE=60`（即 AA ≥ 30），并要求 agentic 下限：AA 测的 Terminal-Bench 4.0 ≥ 10%（`MODEL_MIN_TB`），没有 TB 数据时 AA Agentic Index ≥ 15（`MODEL_MIN_AGENTIC`）。低于门槛的模型不进轮换；`--model` 显式指定的不受限；`MODEL_MIN_SCORE=0` 临时放宽。
   - 依据优先级：`data/*-model-rank.json`（2026-10-16 重建，每条都写了来源和日期，用户可在 `~/.free-agent-crew/config/` 覆盖）→ OpenRouter 公开 `/api/v1/models` 里的 AA 指数（无需 key，24 小时缓存，拉取失败用过期缓存，再不行只用排名表）→ 试用期估分。
   - 新模型（没有评测）= 试用期：按同家族上一代实测分加不超过 10 分的溢价、付费版旗舰价（≥$2/M 输出 +5）、名字档位估分，最高 79；估分 ≥ 门槛−10（`MODEL_PROVISIONAL_SLACK`）才能进轮换，且永远排在所有达标模型之后；`MODEL_PROVISIONAL=0` 可关掉试用期。设了 `AGENT_EVENTS_LOG` 时，按近 14 天本机成功率：≥5 次且 ≥80% 转正，<50% 降 15 分。
   - `crew models` 显示每个模型的分数，标注“试用期”和“门槛排除”及原因。

## 额度与冷却
- 识别：各 CLI 自己的额度错误、HTTP 429、Too Many Requests、FreeUsageLimitError 等。cline 额度错误打在 stdout 且退出码 0，所以 rc=0 时只认 cline 自己的错误行；kilo/opencode stdout 里只认“错误样式”的行，模型正文里引用这些字眼不会误判。
- 运行中一出现额度错误就杀掉该次运行（有的 CLI 报错后会挂住），同一时刻既命中额度又到总时限时按额度处理。
- 恢复时间：只认**未来**的时间戳（日志里的 `"ts"` 过去时间不算）→ “try again in 5h 29m” → retry-after → 默认（cline/opencode 到下一个 UTC 0 点；kilo 到下一个整点）。
- 状态文件 `~/.free-agent-crew/state/*-quota-state.json`：mkdir 锁 + 临时文件原子替换；损坏/非对象/时钟回拨产生的记录自动忽略。

## 盲区清单（都已处理）
见 `docs/BLINDSPOTS.md`。

## 测试
```sh
npm test                    # node:test，49 个用例：假 CLI 覆盖切换/75/124/77/127/stdin/act 模式/并发锁/Windows shim 与 PATH 逻辑/能力门槛（排除、试用期排序、评测拉取失败回落、--model 绕过）
sh test/docker-linux.sh     # 有 docker 时在一次性容器里跑测试和安装
```

## 已知限制
- 免费额度规则由各厂商随时调整；正则与默认冷却按 2026-10 的行为写成，可用环境变量 `CREW_<员工>_FREE_MODELS`、`CREW_<员工>_URL` 覆盖。
- `KILO_DISABLE_AUTOUPDATE` 是按 opencode 分叉惯例设置的，未在 kilo 官方文档中确认；kilo 的 JSONC 配置不会被改。
- 员工默认只读是“提示词约束”，不是沙箱；`--write` 才明确允许改文件。
