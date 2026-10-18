# 更新记录

## v1.3.8（2026-10-18）
- **对齐现网 builtin-gate**：现网 opencode-auto / cline-auto / kilo-auto 在拉不到模型列表、改用内置候选池（BUILTIN）时，普通调用的候选池也走生产级门槛（与 v1.3.6 的规划失败回落是同一套机制）。`--model` 指定的保留，判断类调用不变；没有生产级模型就退出 75，零调用。kilo 的内置池只留免费模型，删掉了收费的 ling-3.1-flash。
- Node 版拉不到列表时用的就是每个员工的 `builtin`，从 v1.3.6 起只含生产级（kilo 为空，`test/pools.test.js` 守着），所以行为已经一致，代码不用改。
- 新增 `test/offlinepool.test.js`：拉不到列表时，kilo 退出 75 且零调用（不会用收费模型），cline 只用 mimo（不会先用 muse-spark），opencode 从第一个生产级模型开始、不调用弱模型。测试 89 → 92。

## v1.3.7（2026-10-18）
- **对齐现网 delisted-pool**：现网 opencode-auto / cline-auto / kilo-auto 的常规候选池（BUILTIN，拉不到模型列表时用）删掉已下架的 opencode/step-5-preview-free、cline-free/step-5-preview、kilo/stepfun/step-5-preview-free（2026-10-18 已对照各家 CLI 和 API 的当前模型列表）。Node 版每个员工只有一份内置名单，v1.3.6 已经只留生产级、没有这些 ID，所以代码不用改。
- 新增 `test/pools.test.js`：内置名单不得含已下架 ID，且每个 ID 按内置排名表都必须是生产级（kilo 为空）。测试 87 → 89。
- 排名表里的 step-5-preview 条目保留（仍是评分历史，测试夹具也用到），不参与候选池。

## v1.3.6（2026-10-18）
- **规划失败时的内置回落名单只用生产级**（对齐现网 opencode-auto / cline-auto / kilo-auto 的 fallback-swap）：
  - opencode 改为 deepseek-v4.1-flash-free → glm-5.3-flash-free → mimo-v2.6-flash-free；step-5-preview-free 已不在免费名单里，删掉。
  - cline 只留 mimo-v2.6-flash：删掉 muse-spark（只有 proxy 证据）和已下架的 step-5-preview。
  - kilo 清空：2026-10-18 kilo 没有生产级免费模型，step-5-preview、ling-3.1-flash 已改为收费。
  - 回落时不管是不是判断类调用，都再按 `gate.judgeGrade` 过滤一次，`--model` 指定的保留。没有剩下的模型 → 退出码 75，日志 `fallback_drop` / `fallback_grade_failed`，不会用到弱模型。
- `data/opencode-model-rank.json`、`data/kilo-model-rank.json` 与现网同步：big-pickle、longcat-2.5-preview、space-bunny、glyph-cluster 标 `rating: unrated`，xing4.0-29b-a4b 标 `vendor_reported`，并附 `public_scores` / `sources`；score 和 evidence 不变，门槛判定不变。
- 测试 85 → 87（`test/plantimeout.test.js`）：opencode 回落的生产级模型全部限额时退出 75，不调弱模型；cline 回落用 mimo；kilo 回落为空时退出 75，零调用。

## v1.3.5（2026-10-18）
- **规划器 30 秒封顶**（对齐现网 opencode-auto / cline-auto / kilo-auto 的 timeout-hardening）：`M.plan()` 超过 `CREW_PLAN_TIMEOUT` 秒（默认 30）还没结束，就当作规划失败（日志 `planner_failed planner_timeout 30s`），走原来的内置名单回落。判断类调用照样在回落之后过判断门，不会落到弱模型。
- 现网另外两项改动在 crew 里已经等价，没有改代码：现网是用子进程调 model_gate.py，crew 在进程内用 `lib/gate.js` / `lib/region.js` 评分，没有子进程可挂住；现网把阻塞的 flock 改成非阻塞重试、60 秒封顶，crew 的 `util.withLock` 本来就是非阻塞的 mkdir 锁，15 秒后拆锁。
- 测试 83 → 85：新增 `test/plantimeout.test.js`，模拟规划器卡住：普通调用 1 秒后回落内置名单并成功；判断类调用回落后仍只用生产级模型。

## v1.3.4（2026-10-18）
- **判断类调用只用生产级**（对齐现网 opencode-auto / cline-auto / kilo-auto 的 judgement-gate 与 check_ledger 第 9 项）：判断类 = `crew review` / `crew cross` 审查员和 review 汇总，或 `AUTO_JUDGEMENT=1`（`CREW_JUDGEMENT=1`），或 `AGENT_CALLER` / `AGENT_TASK` / `AGENT_ROLE` 含 review、verdict、judge、accept、audit、verify、supervision、second-vote、复核、判断、验收、裁决。只在生产级模型间选择和切换（新 `gate.judgeGrade`：全部排名表合并、固定 baseline、status=pass 且 evidence 为 measured/openrouter_aa；`--model` 弱模型和离线内置回落同样过滤）。没有生产级 → 退出码 **78**（日志 `judgement_no_prod`，事件 `judgement_no_prod`）；生产级用尽 → 75 并注明不退到弱模型。非判断类调用不变。
- 测试 76 → 83：新增 `test/judgement.test.js`；review 用例给桩模型补实测排名条目；“proxy 不计票”改为直接测 `voteOf`（review 中弱 `--model` 现在会被判断门换成生产级）。

## v1.3.3（2026-10-18）
与 2026-10-18 现行规则（SSOT 管理者规则 1–7 条、quota-map、`*-model-rank.json`、model_gate、model-discover v4、opencode-auto v1.4 / cline-auto v3.6）对齐。
- **地区屏蔽**（新 `lib/region.js`，对齐 model_gate.region_* 和包装器）：地区/国家限制报错不重试、立刻换下一个模型（日志 `region_blocked`，事件 `switch reason=region_blocked`），记入 `config/region-blocked-models.json` 7 天；到期复查一次（带防并发 claim），成功即移除（`region_recovered`）；`--model` 指定的不跳过；`crew quota` 列出被屏蔽模型。判定比参考实现更严：命中行还必须像报错，且 crew 自己的标识/文件名（region-blocked-models.json、region_blocked=…）不算——参考实现的 REGION_RE 会把 `ls` 输出里的文件名当成地区报错。
- **`--model` 时也置顶 preferred**：顺序为 指定模型 → 置顶模型 → 其余，与 opencode-auto v1.4 一致。
- **离线内置名单**：三家 `builtin` 只收能过门槛的模型，opencode 以首选 deepseek-v4.1-flash-free 开头、glm 其次。
- **`crew quota` 文案**：“最强达标模型冷却中”改为“排序第一 X（首选/置顶 或 能力分最高）冷却中”；新增字段 `pinned`、`region_skipped`（`rank_top_model` 保留）。
- **订阅模型表**：新增 `data/subscription-model-rank.json`（与现网逐字节一致），不参与免费池轮换，供 model-discover 与复核票分级。
- **model-discover v4**：`extras/model-discover/model-discover.py` 同步现网 v4（新增 cursor-agent `--list-models`、agy `models` 两个只列名单的来源）；README 补五个来源、`CURSOR_AGENT_BIN` / `AGY_BIN` / `MODEL_DISCOVER_TIMEOUT`，写清 `OPENCODE_REAL` 默认值。
- **复核票与派活规则**：新增 `docs/RULES.md`（不写分数，以 rank.json 为准）：正式票 opencode deepseek-v4.1-flash 与 cursor-agent grok-4.7-high 并列第一 → cline mimo-v2.6-flash → agy gemini-3.8-flash-high；kilo、sonnet-5 不计票；不用 codex；Claude Opus 只在用户新建任务或点名时用；M3.1-Flash-Preview 能做的活优先派它（私有资料除外）；复核标准做法和票格式。SKILL.md、prompts/review.md、patterns.md、README 同步。
- **`crew review` / `crew cross` 计票**：审查员默认顺序 opencode → cline → kilo；每个结果带 `vote` / `vote_note`（kilo 恒不计票；只有生产级 = 过门槛且 evidence 为 measured/openrouter_aa 的成功结果计票）；输出末尾列出计票和“至少一票生产级”；合并时不计票意见只作参考。
- 文档说明：排名表 `_note` 里的 model_gate.py 对应 crew 的 `lib/gate.js` / `lib/region.js`；preferred 来源（内置表 + 用户表整块覆盖）是与现网的有意差异。
- 测试新增 `test/region.test.js`、`test/votes.test.js` 和 2 个 preferred 用例。

## v1.3.2（2026-10-18）
- **内建排名表与现网对齐**：`data/` 下 kilo / cline / opencode 三份 `*-model-rank.json` 整份换成现网版本。新增 opencode/glm-5.3-flash-free、opencode/deepseek-v4.1-flash-free（含厂商自报的 1017 数据 `vendor_1017`，不计分，并附 `watch` 复测提示），以及 beam-free、nemotron-3.5-super-vl（Terminal-Bench 不达标，门槛排除）、kilo/xingchen-agi/xing4.0（试用期）。
- **首选模型 `preferred`（对应现网 opencode-auto v1.4）**：排名表顶层新增 `preferred` 块，用户表里的会整块替换内置的。
  - `order`：过门槛后把已达标的模型置顶，被门槛排除或不在免费名单里的不置顶；`--model` 和手写名单（`CREW_<员工>_FREE_MODELS`）不受影响。
  - `fallback_on_error`：列出的模型报任何错（额度、超时、登录错误之外）都换下一个，日志 `pinned_error`，事件 `switch reason=pinned_error`；`--model` 指定的不换。若所有模型都只是报错、没有碰到额度，退出码是 CLI 自己的退出码，而不是 75。
  - `variant`：只对 opencode 生效，追加 `--variant <值>`；用户自己传了 `--variant` 时不追加。
  - `lib/models.js` 新增 `preferredOf()`，`plan()` 返回值新增 `variants`、`fallbackOnError`。
- **可选组件 `extras/model-discover/`**：每天比对三家免费名单与 OpenRouter 上游快照，写待评测队列和告警，从不改排名表。附 macOS launchd 模板、Linux cron 示例和回滚步骤；不进安装脚本默认流程。
- 测试新增 `test/preferred.test.js`（6 个用例），共 66 个。
