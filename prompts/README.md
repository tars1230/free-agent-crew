# 派单提示词模板（给总控 agent 直接复制）

把 `<尖括号>` 换成实际内容后整段发给总控 agent（Claude Code / Codex / WorkBuddy / Hermes / Cursor …）。总控 agent 会用 `crew` 把活派给免费员工，再自己复核结论。

| 文件 | 用途 |
|---|---|
| [install-new-device.md](install-new-device.md) | 新设备一句话安装 |
| [single-worker.md](single-worker.md) | 单员工派活（ask / run） |
| [review.md](review.md) | 多员工并行互审 |
| [brainstorm.md](brainstorm.md) | 脑暴 → 收敛 |
| [relay.md](relay.md) | 起草 → 挑错 → 定稿接力 |
| [cross.md](cross.md) | 一人做、其余人审 |

> 员工实际收到的运行时提示词（复核/脑暴/接力各阶段、只读守卫、汇总）写在 `lib/crew.js` 的 `TPL`/`relay` 与 `lib/engine.js` 的 `guard` 中，由代码拼接，改动会影响行为与测试，因此不在这里复制。
