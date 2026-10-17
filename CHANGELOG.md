# 更新记录

## v1.3.2（2026-10-18）
- **内建排名表与现网对齐**：`data/` 下 kilo / cline / opencode 三份 `*-model-rank.json` 整份换成现网版本。新增 opencode/glm-5.3-flash-free、opencode/deepseek-v4.1-flash-free（含厂商自报的 1017 数据 `vendor_1017`，不计分，并附 `watch` 复测提示），以及 beam-free、nemotron-3.5-super-vl（Terminal-Bench 不达标，门槛排除）、kilo/xingchen-agi/xing4.0（试用期）。
- **首选模型 `preferred`（对应现网 opencode-auto v1.4）**：排名表顶层新增 `preferred` 块，用户表里的会整块替换内置的。
  - `order`：过门槛后把已达标的模型置顶，被门槛排除或不在免费名单里的不置顶；`--model` 和手写名单（`CREW_<员工>_FREE_MODELS`）不受影响。
  - `fallback_on_error`：列出的模型报任何错（额度、超时、登录错误之外）都换下一个，日志 `pinned_error`，事件 `switch reason=pinned_error`；`--model` 指定的不换。若所有模型都只是报错、没有碰到额度，退出码是 CLI 自己的退出码，而不是 75。
  - `variant`：只对 opencode 生效，追加 `--variant <值>`；用户自己传了 `--variant` 时不追加。
  - `lib/models.js` 新增 `preferredOf()`，`plan()` 返回值新增 `variants`、`fallbackOnError`。
- **可选组件 `extras/model-discover/`**：每天比对三家免费名单与 OpenRouter 上游快照，写待评测队列和告警，从不改排名表。附 macOS launchd 模板、Linux cron 示例和回滚步骤；不进安装脚本默认流程。
- 测试新增 `test/preferred.test.js`（6 个用例），共 66 个。
