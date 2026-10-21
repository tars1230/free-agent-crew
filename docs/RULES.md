# 复核票与派活规则（v1.3.4，对齐 2026-10-18 现行规则）

本页是 crew 使用方（总控 agent）的派活和复核约定。**这里不写任何模型分数**：分数和“是否生产级”一律以排名表为准——
`data/*-model-rank.json`（cline / kilo / opencode 免费池，外加 `data/subscription-model-rank.json` 收录的 cursor-agent / agy 订阅模型），
用户可在 `~/.free-agent-crew/config/` 覆盖同名文件。新模型由可选组件 [`extras/model-discover`](../extras/model-discover/README.md) 每天发现、进待评测队列，评测后再更新排名表；榜单变了，以表为准，本页不用改。

## 生产级
过能力门槛（`lib/gate.js`：score ≥ `MODEL_MIN_SCORE`，并满足 Terminal-Bench / AA Agentic 下限），**而且**分数证据是实测（`evidence` 为 `measured` 或 `openrouter_aa`）。
`proxy`、`vendor`、`none`、试用期估分（provisional）都不算生产级。判定不看本机成功率。

## 正式复核票（按顺序）
1. 并列第一：**opencode `deepseek-v4.1-flash`**（opencode 首选 `opencode/deepseek-v4.1-flash-free`，`--variant max`；glm-5.3-flash-free 兜底，见 opencode 表的 `preferred` 块）与 **cursor-agent `grok-4.7-high`**。
2. 其次：**cline `mimo-v2.6-flash`**（`cline-free/mimo-v2.6-flash`）。
3. 最后：**agy `gemini-3.8-flash-high`**。

要求：每票写明工具和模型名；至少一票是生产级。

不计复核票（可以干活）：
- **kilo**：照常干活，但不算复核票。`crew review` / `crew cross` 里 kilo 的意见标“参考（不计票）”。
- **sonnet-5**：可以干活，不算复核票。
- 任何非生产级模型的意见：只作参考。

不用：**codex**（含 codex-v4flash，2026-10-18 起不用）。**Claude Opus** 额度宝贵：只在用户新建任务或单独点名时用，日常复核和干活都不用。

## 派活
- **MiniMax M3.1-Flash-Preview**：它能做的活（批量、机械类）优先派给它；**带私有资料的除外**。
- 带私有资料的活不走会拿提示词训练的免费池（cline / kilo / opencode 免费档都算），改用订阅工具。
- 派活写清：目标、验收命令（accept_cmd）、禁区、超时。

## 复核的标准做法
- 只读调用：cursor-agent 用 `--mode ask --model grok-4.7-high`；agy 用 `-p` 并在提示词里写明“只读，不改文件”；opencode 用 `opencode-auto`（会按 `preferred` 选 deepseek，并记下实际用的模型）；crew 用 `crew review`（默认只读）。
- diff 先写到文件（例如 `git diff > /tmp/review-<id>.diff`），提示词里给路径。
- 必须显式指定 `--model`：没写模型名的（例如 agy 默认模型）算未评分，不计票。
- 调用 cursor-agent 必须显式写 `--model`，默认 `grok-4.7-high`；claude-opus、sonnet 等非 xAI 模型只在用户点名时用（2026-10-19 用户定；漏写 `--model` 会落到旧默认 claude-sonnet-5，占「其他模型」额度）。
- 票的格式：`工具(模型名) APPROVE|REJECT: 一句理由`，模型名和 rank.json 里的键一致。

```bash
cursor-agent -p --trust --mode ask --model grok-4.7-high "只读复核 /tmp/review-<id>.diff：…"
agy --dangerously-skip-permissions --model gemini-3.8-flash-high -p='只读，不改文件。复核 /tmp/review-<id>.diff：…'
opencode-auto run "只读复核 /tmp/review-<id>.diff：…" < /dev/null
crew review "只读复核 /tmp/review-<id>.diff：…" --cwd <仓库>
```

## crew 里怎么体现（v1.3.3）
- `crew review`、`crew cross` 的审查员默认顺序是 opencode → cline → kilo（`--workers` 或 `CREW_ORDER` 可改）；`ask` / `relay` 等其它模式仍是 kilo → opencode → cline（省额度）。
- 每个审查结果带 `vote` / `vote_note`（`--json` 和 `summary.json` 里都有）：kilo 恒为不计票；其余只有生产级模型、且跑成功时才计票。输出末尾一行列出计票的工具(模型)，以及“至少一票生产级：是/否”。
- 合并（synthesis）时，不计票的意见只作参考，不能单独决定裁决。

## 判断类调用只用生产级（v1.3.4）
复核、验收、审计、supervision 等判断类调用只交给生产级模型；弱模型（provisional、proxy、vendor、无评测等）只干活不判断。crew 的 `review` / `cross` 审查与 review 汇总自动按判断类处理；其它调用设 `AUTO_JUDGEMENT=1`，或让 `AGENT_CALLER` / `AGENT_TASK` / `AGENT_ROLE` 带上 review、verify、复核、验收等词。没有可用生产级模型时退出 78，不退到弱模型。
