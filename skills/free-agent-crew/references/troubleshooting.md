# 故障排查与已知限制

- **找不到 `crew`**：不要猜路径，用 `{{CREW_ABS}} <子命令>`，或 `node "{{CREW_HOME}}/app/bin/crew.js"`。
- **cline 无反应/全中文问题被拒**：已自动处理；仍失败看 `{{CREW_HOME}}/logs/cline.log`。
- **cline 被强杀后全局停在 act 模式**：crew 运行 cline 时临时把全局 `planActMode` 切到 act（多个并发运行用引用计数），最后一个运行结束时还原。若进程被 `kill -9`/断电强杀，来不及还原；下一次 crew 运行 cline 结束时会自动剔除死进程并还原。急用可在 cline 设置里手动切回 plan。
- **一直 75**：额度是厂商按 IP/账号计的，等恢复时间；或 `crew models` 看是否全被能力门槛排除，必要时 `MODEL_MIN_SCORE=0` 临时放宽。
- **员工"只读"**：是提示词约束，不是沙箱；涉及敏感目录不要派给员工。
- **免费额度规则会变**：可用 `CREW_<员工>_FREE_MODELS`、`CREW_<员工>_URL` 覆盖名单来源。
