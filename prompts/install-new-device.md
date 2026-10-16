# 新设备一句话安装

```
请在这台电脑上安装 free-agent-crew：取得 free-agent-crew-<版本>.zip（我给你的文件；或在已登录 gh 的机器上 `gh release download -R tars1230/free-agent-crew --pattern "free-agent-crew-[0-9]*.zip"`，仓库是私有的，未登录无法下载），解压到 ~/Downloads，macOS/Linux 运行 `sh ~/Downloads/free-agent-crew/install.sh`，Windows 运行 `powershell -ExecutionPolicy Bypass -File $HOME\Downloads\free-agent-crew\install.ps1`。装完运行 `crew doctor`，把"需要你做的事"（例如 cline auth 登录）原样告诉我，不要替我登录。
```

只装 skill（已装好 crew，只想让另一个 agent 认识它）：

```
请把 free-agent-crew-skill-<版本>.zip 解压到你的技能目录（例如 ~/.claude/skills/、~/.codex/skills/、~/.agents/skills/），得到 free-agent-crew/SKILL.md 和 references/，然后运行 `crew doctor` 确认可用。
```
