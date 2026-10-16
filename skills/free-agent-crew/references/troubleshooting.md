# 故障排查与已知限制

- **找不到 `crew`**：不要猜路径，用 `{{CREW_ABS}} <子命令>`，或 `node "{{CREW_HOME}}/app/bin/crew.js"`。
- **cline 无反应/全中文问题被拒**：已自动处理；仍失败看 `{{CREW_HOME}}/logs/cline.log`。
- **cline 被强杀后全局停在 act 模式**：crew 运行 cline 时临时把全局 `planActMode` 切到 act（多个并发运行用引用计数），最后一个运行结束时还原。若进程被 `kill -9`/断电强杀，来不及还原；下一次 crew 运行 cline 结束时会自动剔除死进程并还原。急用可在 cline 设置里手动切回 plan。
- **一直 75**：额度是厂商按 IP/账号计的，等恢复时间；或 `crew models` 看是否全被能力门槛排除，必要时 `MODEL_MIN_SCORE=0` 临时放宽。
- **员工"只读"**：是提示词约束，不是沙箱；涉及敏感目录不要派给员工。
- **免费额度规则会变**：可用 `CREW_<员工>_FREE_MODELS`、`CREW_<员工>_URL` 覆盖名单来源。
- **退出码 127 / doctor 显示“员工 X 未安装”**：运行 `crew setup` 重装；用自定义 npm 目录（`NPM_CONFIG_PREFIX` 或 `~/.npmrc` 里的 `prefix=`）时 crew 也会去那里找；还找不到就用 `CREW_<员工>_BIN=/绝对路径` 指定。
- **退出码 77（需要登录）**：只有 cline 需要账号，请用户自己运行 `cline auth`；不要替用户登录，也不要读取凭据文件。
- **超时、网络错误、名单“来源=builtin”**：多半是网络问题。国内网络请设置 `HTTPS_PROXY`（装 CLI 也可以用 `CREW_NPM_REGISTRY=https://registry.npmmirror.com`）。模型调用地址（api.cline.bot、api.kilo.ai、opencode.ai）连不上时，员工就用不了。详见安装包里的 `docs/REQUIREMENTS.md`。
- **一直是 75 但 `crew quota` 显示绿色**：额度是厂商按 IP 或账号计的，同一出口 IP 下的其他人也在消耗；等 `cooling[].reset_at` 给出的时间恢复。
- **托盘没出现**：macOS 需要 Xcode 命令行工具（`xcode-select --install`），然后重新运行 `crew tray install`；Windows 的图标可能在任务栏 `^` 折叠区；Linux 不装托盘，用 `crew quota --line` 接入状态栏。
