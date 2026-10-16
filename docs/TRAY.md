# 状态栏 / 托盘显示（可选，默认不装）

数据都来自 `crew quota --json`（只读本机记录：`~/.free-agent-crew/logs/events.jsonl`、`state/*-quota-state.json`、模型名单缓存；**不联网、不耗额度**）。三个圆点从左到右是 cline、kilo、opencode：

| 颜色 | 含义 |
|---|---|
| 🟢 绿 | 有达标（非试用期）模型可用、未冷却 |
| 🟡 黄 | 达标模型都在冷却，只剩试用期（无评测）模型；或能力门槛模块出错 |
| 🔴 红 | 没有可用模型（全部冷却或全部低于门槛） |
| ⚪ 灰 | 没数据：CLI 未安装，或从没用过且没有模型名单缓存 |

"能力分第一的模型不在免费名单""最强模型冷却中但还有别的达标模型"只作为信息行，不改变颜色。kilo 显示"本小时调用 x 次"，它的限额按**请求数**算（约 200 次/小时·IP），一次调用可能包含多次请求，所以这个数只是下限参考。

## 安装与卸载
```sh
sh install.sh --tray              # macOS（Linux 上只打印说明）
sh install.sh --uninstall-tray
powershell -ExecutionPolicy Bypass -File install.ps1 --tray            # Windows
powershell -ExecutionPolicy Bypass -File install.ps1 --uninstall-tray
crew tray install | uninstall | status                                 # 已安装 crew 时直接用
```
可重复运行：再次安装 = 重新编译/覆盖并重启。

## macOS（已实测）
- 一个约 100 行的 AppKit 菜单栏程序（`tray/macos/main.swift`），安装时用本机 `swiftc` 编译到 `~/.free-agent-crew/tray/CrewQuota.app`，ad-hoc 签名。
- 需要 Xcode 命令行工具（`xcode-select --install`）；没有 `swiftc` 时跳过并提示，其余安装照常完成。
- 登录自启：`~/Library/LaunchAgents/io.github.free-agent-crew.quota.plist`（只属于当前用户）。卸载会 `launchctl bootout` 并删除 plist 和 app。
- 每 60 秒刷新；菜单里有每个员工的调用数、成功率、首选模型、降级原因/信息、门槛（最低分·排除·试用期·无结束记录）、冷却恢复时间、kilo 本小时调用、最近失败、打开日志、立即刷新、退出。

## Windows（代码审查 + PowerShell 语法检查；未在 Windows 实机运行）
- `tray/windows/crew-tray.ps1`：PowerShell + .NET WinForms `NotifyIcon`，不装任何软件；图标是现画的 16×16 三圆点（按颜色组合缓存，长时间运行不泄漏 GDI 句柄）；右键菜单显示同样的明细。
- 登录自启：在"启动"文件夹放一个快捷方式（`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\free-agent-crew tray.lnk`），隐藏窗口运行 `powershell -STA -File crew-tray.ps1`。
- 重复安装会覆盖脚本，旧实例发现脚本被改写后在 1 分钟内自行退出、只保留新实例。
- 卸载：删除快捷方式和脚本；正在运行的托盘最多 1 分钟内发现脚本已删除并自行退出（不强杀进程）。
- 已知：图标可能先出现在任务栏 `^` 折叠区，需要手动拖出来；公司电脑若禁止运行 PowerShell 脚本（组策略），托盘无法启动。

## Linux（不装常驻程序）
桌面环境差异太大（GNOME 需要扩展且随版本变 API，KDE/Xfce/各种 WM 各不相同），做一个通用托盘成本高、不可靠，所以只提供一行输出 `crew quota --line`（如 `cline🟢 kilo🟡 opencode🟢`），接到你已有的状态栏：

- **waybar**（`~/.config/waybar/config`）
  ```json
  "custom/crew": { "exec": "crew quota --line", "interval": 60, "on-click": "x-terminal-emulator -e sh -c 'crew quota; read x'" }
  ```
- **polybar**
  ```ini
  [module/crew]
  type = custom/script
  exec = crew quota --line
  interval = 60
  ```
- **i3blocks**：`[crew]` / `command=crew quota --line` / `interval=60`
- **tmux**：`set -g status-right '#(crew quota --line)'`，`set -g status-interval 60`
- **GNOME**：装任一"执行命令并显示输出"类扩展（如 Executor / Command Menu），命令填 `crew quota --line`。
- **终端**：`watch -n 60 crew quota`

`crew` 不在 PATH 时把命令换成 `node ~/.free-agent-crew/app/bin/crew.js`。
