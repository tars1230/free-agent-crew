# 更新记录

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
