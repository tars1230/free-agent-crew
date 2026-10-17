# model-discover（可选组件）

每天两次比对 cline / kilo / opencode 的免费模型名单，发现**新模型、排名表里没有的模型、已排名模型的上游新快照**（例如 `deepseek-v4.1-flash-1017`），写进待评测队列并留一条告警。

- 只报告，**从不改排名表**：要不要收录、给多少分，仍由人按 `lib/gate.js` 的门槛规则手工写进 `*-model-rank.json`。
- 不是 `crew` 的一部分：安装脚本（`install.sh` / `install.ps1`）不会装它，`crew` 运行时也不依赖它。不装没有任何影响。
- 需要 Python 3（只用标准库）。macOS 第一次运行 `/usr/bin/python3` 可能弹窗要求装命令行工具，装完即可。
- 会访问：`opencode.ai`、`api.kilo.ai`、`api.cline.bot`、`openrouter.ai`（都是公开接口，不需要 key）。

## 三家怎么覆盖
| 员工 | 名单来源 | 说明 |
|---|---|---|
| opencode | `opencode.ai/zen/v1/models` 里的 `*-free` 和 `big-pickle`，**并集**本机 `opencode models opencode` | `crew` 用的是交集（CLI 不认识的模型跑不了）；这里取并集，并把“API 有、本机 CLI 没有”的单独记一条 `api_not_in_cli`，提醒升级 opencode CLI |
| kilo | `api.kilo.ai/api/gateway/models` 里 `isFree` 的文本模型 | 排除规则与 `crew`（`lib/workers.js`）一致：kilo-auto、音乐/TTS/审核/嵌入等 |
| cline | `api.cline.bot/api/v1/ai/cline/recommended-models` 的 `free` | |
| 上游快照 | OpenRouter 公开 `/api/v1/models` | 30 天内新出现、名字是“已排名模型 + 日期后缀”（MMDD / YYMMDD / YYYYMMDD）的模型，按 `upstream_snapshot` 入队，附 OpenRouter 上的 AA 分 |

每家第一次运行只记基线、不报事件，避免第一次刷屏。某一家拉取失败或名单为空时，这家本次不更新基线。

## 文件位置
脚本自己的默认路径在 `~/.shared/`（沿用原环境）。和 `crew` 一起用时，建议按下表用环境变量指到 `~/.free-agent-crew/`（launchd 模板已经这样写好）：

| 文件 | 环境变量 | 建议位置 | 内容 |
|---|---|---|---|
| 排名表目录 | `MODEL_RANK_DIR` | `~/.free-agent-crew/app/data` | 读 `<员工>-model-rank.json`，判断“已排名/未排名” |
| 基线 | `MODEL_DISCOVER_STATE` | `~/.free-agent-crew/state/model-discover-seen.json` | 每家上次看到的名单、已报过的快照 |
| 待评测队列 | `MODEL_EVAL_QUEUE` | `~/.free-agent-crew/state/model-eval-queue.jsonl` | 一行一个 JSON：`agent model reason ts status`（`reason`：`new_unranked` / `unranked` / `new_ranked` / `upstream_snapshot`） |
| 告警 | `MODEL_DISCOVER_ALERT` | `~/.free-agent-crew/logs/model-discover.alert` | 有新入队时追加一行中文摘要 |
| 运行日志 | `MODEL_DISCOVER_LOG` | `~/.free-agent-crew/logs/model-discover.log` | 每次运行一行：事件数、入队数、备注 |
| opencode 命令 | `OPENCODE_REAL` | `opencode`（在 PATH 上找） | 脚本默认 `/opt/homebrew/bin/opencode`；找不到只会少一个来源（记 `cli_failed`），不会报错退出 |

注意：`MODEL_RANK_DIR` 指向内置表时，你在 `~/.free-agent-crew/config/` 里自己补充的模型不会被当成“已排名”，会照样入队，标记一下即可。

队列处理：评测完把那一行的 `status` 改成 `done` 或 `rejected`。任何状态的条目都不会再次入队。手工改队列时先别让脚本同时运行（脚本运行期间持有 `model-eval-queue.jsonl.lock` 的文件锁）。

## 手动运行
```sh
mkdir -p ~/.free-agent-crew/extras && cp -R extras/model-discover ~/.free-agent-crew/extras/
export MODEL_RANK_DIR=~/.free-agent-crew/app/data \
  MODEL_DISCOVER_STATE=~/.free-agent-crew/state/model-discover-seen.json \
  MODEL_EVAL_QUEUE=~/.free-agent-crew/state/model-eval-queue.jsonl \
  MODEL_DISCOVER_ALERT=~/.free-agent-crew/logs/model-discover.alert \
  MODEL_DISCOVER_LOG=~/.free-agent-crew/logs/model-discover.log \
  OPENCODE_REAL=opencode
python3 ~/.free-agent-crew/extras/model-discover/model-discover.py --dry-run   # 只打印 EVENT/NOTE，不写任何文件
python3 ~/.free-agent-crew/extras/model-discover/model-discover.py             # 正式运行
cat ~/.free-agent-crew/logs/model-discover.alert                                # 有没有新东西
```

## macOS：用 launchd 每天 9:10 和 18:10 跑
```sh
label=com.free-agent-crew.model-discover
mkdir -p ~/Library/LaunchAgents
sed "s#__HOME__#$HOME#g" ~/.free-agent-crew/extras/model-discover/$label.plist.example > ~/Library/LaunchAgents/$label.plist
plutil -lint ~/Library/LaunchAgents/$label.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$label.plist
launchctl kickstart gui/$(id -u)/$label     # 立刻跑一次试试
tail /tmp/free-agent-crew-model-discover.err.log ~/.free-agent-crew/logs/model-discover.log
```
模板用 `nice -n 10` 降优先级，用 `perl alarm 180` 保证单次最多 3 分钟。

## 回滚 / 卸载
```sh
label=com.free-agent-crew.model-discover
launchctl bootout gui/$(id -u)/$label
rm -f ~/Library/LaunchAgents/$label.plist
rm -rf ~/.free-agent-crew/extras/model-discover
# 需要的话再删数据：
rm -f ~/.free-agent-crew/state/model-discover-seen.json ~/.free-agent-crew/state/model-eval-queue.jsonl* ~/.free-agent-crew/logs/model-discover.*
```
不影响 `crew` 本身的任何文件。

## Linux：用 cron
`crontab -e` 加一行（时间和 macOS 模板一致；`timeout 180` 来自 coreutils）：
```cron
10 9,18 * * * MODEL_RANK_DIR=$HOME/.free-agent-crew/app/data MODEL_DISCOVER_STATE=$HOME/.free-agent-crew/state/model-discover-seen.json MODEL_EVAL_QUEUE=$HOME/.free-agent-crew/state/model-eval-queue.jsonl MODEL_DISCOVER_ALERT=$HOME/.free-agent-crew/logs/model-discover.alert MODEL_DISCOVER_LOG=$HOME/.free-agent-crew/logs/model-discover.log OPENCODE_REAL=opencode PATH=$HOME/.free-agent-crew/npm-global/bin:/usr/local/bin:/usr/bin:/bin nice -n 10 timeout 180 python3 $HOME/.free-agent-crew/extras/model-discover/model-discover.py >/dev/null 2>&1
```
回滚：`crontab -e` 删掉这一行，再按上面删文件。

## Windows
暂不提供：脚本用了只有 macOS / Linux 才有的文件锁（`fcntl`），也没有计划任务模板。
