# 命令与选项

```bash
crew doctor [--live] [--quick] [--json]   # 体检；--live 每个员工真答一句 PONG（耗 1 次额度）
crew ask "问题"                            # 第一个有额度的员工回答，用完自动换下一个
crew review "复核 X"                       # 并行只读复核 + 合并共识（末行 VERDICT: PASS|FAIL）
crew brainstorm "主题"                     # 并行脑暴 + 去重排序
crew relay "任务"                          # 起草 → 挑错改进 → 定稿，不同员工接力；某段失败交给下一个
crew cross "任务" [--write]                # 一人做，其余人并行互审
crew run <cline|kilo|opencode> "任务"      # 指定员工
crew status | models | reset              # 额度/冷却、模型能力分、清冷却
crew quota [员工,...] [--json|--line]     # 额度面板：今日调用、成功率、首选模型、冷却恢复时间、门槛排除/试用期数、kilo 本小时调用；🟢🟡🔴⚪
crew tray install | uninstall | status     # 可选状态栏/托盘（macOS 菜单栏、Windows 通知区域；Linux 只给示例）
crew setup [--no-cli] [--no-path] [--no-skills] [--upgrade] [--registry URL] [--force] [--tray] [--uninstall-tray]
cline-auto | kilo-auto | opencode-auto ... # 与原 CLI 参数一致 + 自动换模型
```

通用选项：

| 选项 | 作用 |
|---|---|
| `--workers kilo,opencode` | 限定员工及顺序 |
| `--n 3` | 最多并行人数（默认 3） |
| `--cwd DIR` | 工作目录（`--write` 时只允许改这里） |
| `--timeout S` | 每员工总时限（默认 kilo/opencode 1800s、cline 3600s） |
| `--model kilo=xxx` | 指定某员工的模型（不受能力门槛限制） |
| `--write` | 允许改文件（默认只读，提示词约束，不是沙箱） |
| `--no-synth` | 不做结果汇总 |
| `--json` | 结构化输出 |
| `--file F` / `-` | 从文件 / stdin 读任务 |

能力门槛：`MODEL_MIN_SCORE`（默认 60 = AA 30）、`MODEL_MIN_TB`（10%）、`MODEL_MIN_AGENTIC`（15）；`MODEL_MIN_SCORE=0` 临时放宽。

## crew quota

只读本机记录（`{{CREW_HOME}}/logs/events.jsonl`、冷却状态、模型名单缓存），**不联网、不耗额度**，派活前判断谁能用时优先用它。

| 颜色 | 含义 |
|---|---|
| 🟢 | 有达标模型可用 |
| 🟡 | 达标模型都在冷却，只剩试用期模型；或门槛模块出错 |
| 🔴 | 没有可用模型 → 派活会得到 75，直接告诉用户 `cooling[].reset_at` 恢复时间 |
| ⚪ | 没数据（CLI 未安装或从没用过），不代表没额度 |

`--json` 每个员工字段：`status installed calls_today success_today success_rate unknown_today preferred_model rank_top_model cooling[{model,reset_at,reset_ts}] last_failure gate_excluded_count provisional_count degraded_reasons notes`；kilo 另有 `hour_used hour_limit hour_note`（限额按请求数算，调用次数只是下限）。`unknown_today` = 有开始无结束记录（被强杀或仍在运行）。
