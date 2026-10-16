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
crew setup [--no-cli] [--no-path] [--no-skills] [--upgrade] [--registry URL] [--force]
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
