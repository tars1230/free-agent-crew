# 安装前须知：会下载什么、要不要注册、网络要求

> 依据：本包代码（`install.sh`、`install.ps1`、`lib/setup.js`、`lib/workers.js`、`lib/gate.js`、`lib/doctor.js`）和各厂商官方文档（链接见文末），核实日期 2026-10-16。

## 1. 安装时会联网下载什么

| 什么 | 从哪里 | 什么时候 | 版本 | 校验 / 备选 |
|---|---|---|---|---|
| Node.js | 先找本机已有 Node ≥ 18；没有时 macOS 用 `brew install node`，Windows 用 `winget install OpenJS.NodeJS.LTS`；再不行下载便携版 | 只在本机没有 Node ≥ 18 时 | 便携版是 Node 22 系列当时的最新版（`latest-v22.x`），brew/winget 是它们的当前版本 | 便携版依次试 `CREW_NODE_MIRROR`（你自己设的）→ `nodejs.org/dist` → `npmmirror.com/mirrors/node`；每个包都按同目录的 `SHASUMS256.txt` 校验 SHA256，不一致就换源 |
| 三个员工 CLI | npm：`cline`、`@kilocode/cli`、`opencode-ai` | 只装缺的；`--upgrade` 才升级已装的 | `@latest`，即安装当时 npm 上的最新版，不锁版本 | 没设镜像时：先用你 npm 自己配置的源，失败再用 `registry.npmmirror.com`；设了 `--registry URL` 或 `CREW_NPM_REGISTRY` 时：先用它，失败再用 npm 自己配置的源。完整性由 npm 自带的包校验保证。注意镜像可能同步滞后：实测 npmmirror 已有 `@kilocode/cli` 7.8.12，但对应平台的二进制包 `@kilocode/cli-darwin-arm64@7.8.12` 还没同步，导致 kilo 安装失败；遇到这种情况去掉镜像变量、走代理重装，或稍后再试 |
| crew 自身 | 不联网：就是你拿到的 zip | — | zip 的版本 | 不会自己去 GitHub 拉“最新安装地址” |

安装器**不会**去拉取新的安装脚本，也不会自己升级 crew；升级 crew = 拿到新 zip 再运行一次安装脚本。

## 2. 运行时会联网访问什么

| 什么 | 地址 | 谁访问 | 失败时 |
|---|---|---|---|
| 免费模型名单 | `api.cline.bot/api/v1/ai/cline/recommended-models`、`api.kilo.ai/api/gateway/models`、`opencode.ai/zen/v1/models` | crew，每个 3 秒超时，缓存 1 小时 | 用过期缓存，再不行用包内置名单 |
| 能力评测分 | `openrouter.ai/api/v1/models`（公开接口，不需要 key） | crew，3 秒超时，缓存 24 小时 | 用过期缓存，再不行只用包内排名表 |
| 真正调用模型 | cline → Cline 服务（api.cline.bot）；kilo → Kilo Gateway（api.kilo.ai）；opencode → OpenCode Zen（opencode.ai/zen） | 员工 CLI 自己 | 没有替代：**这一步必须能连上**，连不上就是超时/网络错误 |
| 其它 | opencode 等 CLI 自己可能访问 models.dev 等取模型元数据；cline 登录要打开浏览器访问 Cline 账号页 | 员工 CLI 自己 | 视 CLI 而定 |

crew 不收集、不上传任何数据；运行时给 CLI 加了 `DO_NOT_TRACK=1`，并关闭自动更新和分享。`crew quota` 和托盘只读本机文件，不联网。

## 3. 哪些要注册或登录

| 员工 | 要不要账号 | 免费额度怎么算 | 怎么登录 |
|---|---|---|---|
| **cline** | **要**：免费模型只给有 Cline 账号的用户（可用 Google / GitHub / 邮箱注册，不需要信用卡和 API key） | 按账号、按模型、按天；具体数字官方没公布 | 运行 `cline auth`（或运行 `cline` 按提示），在浏览器完成登录，一次即可 |
| **kilo** | 不要：免费模型允许匿名调用 | 按 IP 每小时 200 次**请求**，登录与否都按 IP 计 | 无 |
| **opencode** | 不要：Zen 免费模型匿名可用，登录 Zen 是可选的 | 按出口 IP 共享，官方没公布具体数字（同一出口 IP 下的人共用） | 无 |

`crew doctor` 会检查 cline 是否登录过（只看配置文件里有没有登录字段，不读取其值），没登录就在“需要你做的事”里写明 `cline auth`。运行中如果 CLI 报 401/未登录/登录过期，crew 立即停止换模型，返回退出码 **77**，并提示怎样登录。

## 4. 网络要求（中国大陆）

- **能直连、通常够用**：`registry.npmmirror.com`、`npmmirror.com`（国内镜像，安装器自动回落）。
- **能连但可能慢或不稳**：`nodejs.org`、`registry.npmjs.org`。
- **可能连不上或很不稳，建议走代理**：`api.cline.bot`、`api.kilo.ai`、`opencode.ai`、`openrouter.ai`、`models.dev`、`github.com`。其中前三个是真正调用模型的地址，连不上员工就用不了；名单和评测分连不上只会退回缓存/内置数据。
- 说明：作者本机经过分流代理，以上地址全部可达，**没有在无代理的大陆网络实测**；上面的分类是按服务部署在境外的一般情况给的参考。

### 设置代理 / 镜像
```sh
# macOS / Linux（装之前在同一个终端里设）
export HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890
export CREW_NPM_REGISTRY=https://registry.npmmirror.com          # 只用国内 npm 镜像
export CREW_NODE_MIRROR=https://npmmirror.com/mirrors/node/latest-v22.x   # Node 先走镜像
sh install.sh
```
```powershell
# Windows
$env:HTTPS_PROXY='http://127.0.0.1:7890'; $env:CREW_NPM_REGISTRY='https://registry.npmmirror.com'
powershell -ExecutionPolicy Bypass -File install.ps1
```
- 端口 `7890` 只是示例，换成你代理软件的 HTTP 端口。
- curl/wget、npm 都认 `HTTPS_PROXY`；Windows 下载 Node 时安装器会把它传给 `Invoke-WebRequest`。
- crew 拉名单时，设置了代理变量就改用 curl（Node 自带的 fetch 不认代理变量）。
- 员工 CLI 运行时会继承这些变量；要长期生效，把 `export` 写进 `~/.zshrc` 或 `~/.bashrc`（Windows 写进用户环境变量）。
- `crew doctor` 会显示 npm 源是否可达、名单能否拉到、是否设置了代理（只显示变量名，不显示值）。

## 5. 离线 / 内网安装
- **crew 本身可以完全离线装**：本机已有 Node ≥ 18 时运行 `sh install.sh --no-cli`（Windows 用 `install.ps1 --no-cli`），不访问网络。
- **员工 CLI 要从 npm 装**。没有外网时，可以在一台同系统、同 CPU 架构、能上网的机器上运行 `npm i -g --prefix ./crew-clis cline @kilocode/cli opencode-ai`，把 `crew-clis` 目录里的内容拷到新机器的 `~/.free-agent-crew/npm-global/`（crew 会自动去这里找，安装器也会把它加进 PATH），或者拷到别处再把其中的 `bin`（Windows 是目录本身）加进 PATH，或用 `CREW_CLINE_BIN`、`CREW_KILO_BIN`、`CREW_OPENCODE_BIN` 指定路径。这个方法**未实测**；opencode 带有平台相关的二进制，所以必须同系统、同架构。
- 离线装好也只是能装：真正派活时仍要能连上第 2 节的模型地址。

## 来源
- Cline 免费模型需要账号：<https://docs.cline.bot/getting-started/free-models>；登录方式：<https://docs.cline.bot/getting-started/authorizing-with-cline>
- Cline 按天、按模型的限额提示（“today's free usage limit for this model”、“free-models-per-day”）：<https://github.com/cline/cline/issues/5301>
- Kilo 匿名可用、每 IP 每小时 200 次：<https://kilo.ai/docs/gateway/authentication>、<https://kilo.ai/docs/gateway/models-and-providers>
- Kilo 登录和匿名的免费请求都按 IP 限流：<https://github.com/Kilo-Org/kilocode/blob/0f55066d/packages/kilo-docs/pages/gateway/usage-and-billing.md>
- OpenCode Zen 登录可选、免费模型列表：<https://dev.opencode.ai/docs/zen/>；匿名额度按出口 IP 共享（第三方实测，不是官方文档）：<https://pi.dev/packages/pi-opencode-direct>
