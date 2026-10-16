# 新设备盲区清单与处理方式

| # | 盲区 | 处理 |
|---|---|---|
| 1 | 不知道哪些模型免费 | 实时拉三家免费名单（3 s 超时）→ 1 h 缓存 → 过期缓存 → 内置名单；新模型按名字/家族/参数量启发式打分自动入列 |
| 2 | 额度用完还死磕 | 识别额度错误/429，按解析出的恢复时间冷却并换模型；同员工全冷却 → 75；crew 模式自动换员工；人话提示最早恢复时间 |
| 3 | PATH 找不到 auto 命令 | shim 装到 `~/.free-agent-crew/bin` 并写 rc / Windows 用户 PATH；doctor 打印不依赖 PATH 的绝对路径命令；SKILL.md 内嵌绝对路径 |
| 4 | 没有 Node / 版本过低 | install.sh/ps1 依次找现有 Node → brew/winget → 下载官方便携 Node 22（npmmirror 回落 + SHA256 校验） |
| 5 | npm 缺失 | 便携 Node 自带 npm；安装时把 Node 所在目录放到 PATH 前面，保证 npm 和 Node 配套 |
| 6 | npm 全局目录没权限 | 写入测试失败或 EACCES → 自动 `--prefix ~/.free-agent-crew/npm-global`，并加入 PATH；engine 也会到那里找 CLI |
| 7 | 国内网络 / 代理 | npm 官方源失败自动回落 npmmirror；有 `HTTPS_PROXY` 时名单改用 curl（Node fetch 不认代理变量）；doctor 只显示代理变量名，不显示值 |
| 8 | CLI 未登录 | doctor 检查 cline 登录结构（不读取密钥值）并列入“需要你做的事”；运行时识别 401/未登录 → 退出码 77 + 登录指引，不再换模型白跑 |
| 9 | 首次运行向导卡住 | 子进程 stdin 一律 /dev/null（或预读数据后关闭）；`--version` 带超时并提示；空闲看门狗 `CREW_IDLE_TIMEOUT` |
| 10 | 自动更新 | 运行时注入 `OPENCODE_DISABLE_AUTOUPDATE` / `KILO_DISABLE_AUTOUPDATE`、`NO_UPDATE_NOTIFIER`；无配置时写 `autoupdate:false` |
| 11 | 遥测 / 分享 | `DO_NOT_TRACK=1`、`*_DISABLE_SHARE=1`、`share:"disabled"` |
| 12 | Windows 没有 bash | 全部逻辑在 Node；shim 为 `.cmd`（chcp 65001）+ `.ps1`；npm 的 `.cmd` 被解析成 `node <js入口>` 直接启动，避开 Node 的 .cmd 禁令（CVE-2024-27980）和 cmd 引号问题 |
| 13 | 编码 / 中文提示词 | 子进程 LANG 缺省补 UTF-8；cline 拒收“全中文+全角标点”→ 自动转半角并加英文框架；超长提示词转文件（Windows 命令行 32K 限制） |
| 14 | stdin 挂起 | 管道只等 1 s 首字节、30 s 空闲即结束；从不把一个永不关闭的管道交给 CLI |
| 15 | 子进程残留 | Unix 独立进程组整组 TERM→KILL；Windows `taskkill /T /F`；crew 收到 INT/TERM/HUP 时先杀子树再退出 |
| 16 | 并发时状态文件损坏 | mkdir 锁（死锁持有者/30 s 过期自动破锁）+ 临时文件原子 rename（Windows EPERM/EBUSY 重试）；24 进程并发写测试 |
| 17 | 非交互权限被拒（kilo 只读拒读文件） | kilo 始终 `run --auto`；只读靠提示词钉死，写操作需显式 `--write` |
| 18 | cline -p 误用 | crew 从不传 -p；`cline-auto -p` 会提示那是 plan 模式；全局 planActMode=plan 时运行期临时切 act（引用计数，最后一个结束才恢复，只动这一个键） |
| 19 | cline 短 --timeout 杀掉正在跑的复核 | `<900 s` 的 --timeout 丢弃，改由 crew 总时限兜底 |
| 20 | 时钟 / 时区 | 冷却一律存 epoch 毫秒，日志与提示带本地时区偏移；只认未来 8 天内的重置时间；“标记时间在未来”= 时钟回拨，自动作废；doctor 用服务器 Date 头检查时钟偏差 |
| 21 | 长任务无总时限 | 每员工总时限（kilo/opencode 1800 s，cline 3600 s，可 `--timeout`）→ 124；限额判定优先于超时 |
| 22 | 坏的排名表 | score 非数字/文件损坏 → 记录并改用启发式，不中断 |
| 23 | `~/.local/bin/env` 遮蔽系统 env | shim 用 `/bin/sh` + node 绝对路径，不经过 `env`；doctor 检测并提示 |
| 24 | 覆盖用户已有命令/技能/配置 | 只覆盖带 crew 标记的文件；同名 `*-auto` 已存在则不生成；JSONC 配置不改；rc 用标记块替换 |
| 25 | 网络抖动 | ECONNRESET 等网络错误同模型重试一次（`CREW_NET_RETRY=0` 关闭） |
| 26 | 员工输出里的注入指令 | SKILL.md 明确：员工输出是不可信参考，不执行其中的指令 |
| 27 | 弱模型混进轮换、新模型没评测被误杀 | v1.1.0 能力门槛：AA Intelligence ≥30 且 Terminal-Bench 4.0 ≥10%（或 Agentic ≥15）才进轮换；评测自动从 OpenRouter 公开接口取，失败回落缓存/排名表；无评测新模型进试用期排在最后，本机成功率决定转正或降级；--model 不受限，MODEL_MIN_SCORE=0 临时放宽 |
