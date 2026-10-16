# 新设备从零安装（发给总控 agent）

```
请在这台电脑上安装 free-agent-crew，按顺序做，不要替我登录任何账号：
1. 取得 free-agent-crew-<版本>.zip，三种来源任选一种：(a) 我直接给你的文件或网盘下载的文件；(b) 如果这台机器已经 `gh auth login` 并且有私有仓库 tars1230/free-agent-crew 的权限，运行 `gh release download -R tars1230/free-agent-crew -p "free-agent-crew-[0-9]*.zip"` 下载最新版。
2. 解压到 ~/Downloads（Windows 是 $HOME\Downloads）。如果在中国大陆且没有全局代理，先按包里 docs/REQUIREMENTS.md 设置 HTTPS_PROXY 或 CREW_NPM_REGISTRY。
3. 运行安装：macOS/Linux 用 `sh ~/Downloads/free-agent-crew/install.sh`；Windows 用 `powershell -ExecutionPolicy Bypass -File $HOME\Downloads\free-agent-crew\install.ps1`。<要状态栏/托盘就加 --tray>
4. 安装器末尾会自动运行一次 `crew doctor --quick`。把“需要你做的事”原样告诉我（通常是让我运行 `cline auth` 登录 Cline 账号，以及新开终端让 PATH 生效）。
5. 等我说登录好了，再运行 `crew doctor` 和 `crew quota`，确认三个员工都可用，并告诉我结果。
```

只装 skill（这台电脑已经装好 crew，只想让另一个 agent 认识它）：

```
请把 free-agent-crew-skill-<版本>.zip 解压到你的技能目录（例如 ~/.claude/skills/、~/.codex/skills/、~/.agents/skills/），得到 free-agent-crew/SKILL.md 和 references/，然后运行 `crew doctor` 确认可用。
```
