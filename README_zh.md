<!-- Owner: src/definition.ts, src/world.ts, src/config.ts, package.json -->

<p align="center">
  <img src="https://raw.githubusercontent.com/Pal-AI-Lab/cortico-world-qqbot/v0.3.0/assets/icon.png" alt="QQ 机器人" width="88" height="88">
</p>

# QQ 机器人(cortico-world-qqbot)

[![npm](https://img.shields.io/npm/v/cortico-world-qqbot?color=1d4ed8)](https://www.npmjs.com/package/cortico-world-qqbot)
![Cortico World API 6](https://img.shields.io/badge/Cortico_World-API_6-1d4ed8)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-19815e)
[![AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-64748b)](LICENSE)

[English](README.md)

让 Coo 连上一个 QQ 机器人入口，经它在 QQ 私聊和群里收发消息。主要面向 Coopanion,也能装在任何 Cortico 部署里。消息走 QQ 官方机器人接口，不需要在电脑上挂 QQ 客户端，也没有个人号被封的风险。

World ID 为 `qqbot`,可以和 OneBot 协议的 `qq` World 同时装。每份部署连接一个机器人账号。

由 [Pal AI Lab](https://github.com/Pal-AI-Lab) 维护，最初由 [leafliber](https://github.com/leafliber) 编写。[npm](https://www.npmjs.com/package/cortico-world-qqbot) · [问题反馈](https://github.com/Pal-AI-Lab/cortico-world-qqbot/issues) · [更新日志](CHANGELOG.md)。从 `cortico-world-qq-official` 换过来的部署要重新扫码绑定。

## 界面预览

以下截图使用扩展的真实面板代码、Cortico 界面组件与示例数据渲染，不含有效扫码授权、真实机器人凭证或私人聊天。

![QQ 扫码连接面板](https://raw.githubusercontent.com/Pal-AI-Lab/cortico-world-qqbot/v0.3.0/assets/screenshots/connection-zh.png)

![连接成功后隐藏二维码](https://raw.githubusercontent.com/Pal-AI-Lab/cortico-world-qqbot/v0.3.0/assets/screenshots/connected-zh.png)

![凭证与接入配置](https://raw.githubusercontent.com/Pal-AI-Lab/cortico-world-qqbot/v0.3.0/assets/screenshots/configuration-zh.png)

## 安装

需要 Node.js 22 或更高版本。发语音和把收到的语音交给模型需要系统装有 FFmpeg（也可配置 `ffmpegPath`）;其余功能不需要。SILK 编解码器随 npm 依赖安装。主包使用 **Cortico World API 6**，开发依赖固定为 `cortico@0.2.6` SDK。

在 Cortico 或 Coopanion 的扩展页选择 **World**，从 npm 安装 `cortico-world-qqbot`，然后重启 Core。已有 Cortico 安装也可通过命令行安装：

```sh
cd extensions
corepack pnpm add cortico-world-qqbot
```

在源码目录运行：

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm verify
```

在 Cortico 或 Coopanion 扩展页选择 **World → 本机目录**，选择本仓库，重启 Core 后加载。运行 `npm pack --ignore-scripts` 可生成包含运行源码、浏览器面板和能力声明的安装包。

旧宿主仍使用 **World API 5** 时，可下载 [GitHub Releases](https://github.com/Pal-AI-Lab/cortico-world-qqbot/releases) 中的 API 5 兼容包，也可从源码生成：

```sh
pnpm pack:api5
```

在扩展页选择生成的 `dist/api5` 目录。该命令同时在 `dist/` 中生成 `.tgz` 包，API 5 版本号带有界面内容哈希，确保宿主加载更新后的页面脚本。兼容包调整入口、manifest 契约版本和 WebUI 方法名，传输与工具使用同一份实现。修改源码后需要重新生成。

## 接入

在 World 的「连接」页点「用手机 QQ 扫码」,用手机 QQ 扫码后选择**新建机器人**并确认授权。页面会自动等结果、保存凭证并连上，消息通道就绪后显示「连接成功」。

- 二维码大约 3 分钟过期，过期后自动换新码，连续换 3 次后等你点「刷新二维码」。
- 拿到凭证后先试着取一次接口令牌;取不到(选了已有机器人时出现过)就提示重扫，不保存这份凭证。
- 扫码建出的是个人机器人：默认只有你自己能私聊;只能拉进你当群主或管理员的群;别人要私聊它，得在 QQ 开放平台「开发设置」里加成体验用户。
- 机器人没连上时，手机 QQ 里会显示它「不在线」。

AppID、AppSecret 和接入参数在「配置」页管理，也可以手动填写。AppSecret 只显示已配置状态，不回显;AppID 存在 `worlds.qqbot.appId`,AppSecret 通过 `WorldContext.storeSecret` 存为部署环境里的 `CORTICO_QQBOT_APP_SECRET`。AppID 不变时 AppSecret 留空会保留原值;换 AppID 必须同时给新的 AppSecret。

绑定页是 QQ 的 `/qqbot/openclaw/connect.html`。本扩展与 OpenClaw 项目无关，只复用 QQ 开放的绑定和机器人接口。

默认走 WebSocket 网关，Intents 为 `33554432`(私聊、群 @ 和群全量消息)。群里要收非 @ 的消息，由群主在机器人资料页把「机器人可获取的群聊消息范围」设成全部消息。

使用 Webhook 时把 `transport` 设为 `webhook`,让 QQ 回调地址指向配置的路径。默认监听 `127.0.0.1:6196/qqbot/callback`,公网入口要自己用 HTTPS 反向代理(QQ 只接受 80、443、8080、8443 端口)。Webhook 的连接状态只表示本地已监听，不代表已收到 QQ 回调。

## 限制与表情包

QQ 对机器人入口的限制写在环境提示词里，每条附带应对方法;每次发送的回执写明这条按被动回复、主动消息还是召回发出，以及还剩几次、还剩多久;平台拒绝时，失败文本写出撞上的是哪一条。

| 限制 | 依据 |
| --- | --- |
| 私聊：对方每发一条消息，30 分钟内最多回复 4 次 | 官方文档为 60 分钟 4 次;10-27 实测 31 分钟后回复仍能送达，取 30 分钟留余量 |
| 群和频道：一条消息之后 5 分钟内最多回复 5 次 | 官方文档 |
| 超出范围算主动消息，对方可以关闭接收 | 官方文档;10-27 实测私聊主动消息能发 |
| 召回消息只在私聊有，对方最后一次找你后的 30 天分四段，每段 1 条 | 官方文档;实测同一段第二条返回 40034122 |
| 发出超过 2 分钟的消息撤回不了 | 官方文档 |
| 只能把表情包当图片发，没有小黄脸、戳一戳、贴表情 | 官方文档 |

省略回复对象时，先回复这个会话里最近一条还能回复的消息，没有才发主动消息。私聊主动消息被拒(40054013 拒收、40034105 无权限)或对方关了主动消息时，改发这一段的召回消息。

提示词请 Coo 在自己的记忆里给表情包单独留一个地方，收图时在能起名的地方写清画面和适用场合，聊天时积极配图，文字和表情包放在同一条里发。存在哪、怎么起名由所用 Persona 决定;没有收藏能力的 Persona 照常工作。

## 事件流

消息投递为 `qqbot.message`，互动、关系变化及其他平台事件投递为 `qqbot.notice`。两者均为 `origin: external`、`trigger: debounce`；Core 负责保存和批处理，Persona 决定是否行动。原始正文、提及、引用、附件和 `message_scene` 保留在 `meta.data`。

进入模型上下文的正文与 Cortico 内建 QQ World 同形，每条一行：

```text
#12 [私聊 21:32] 用户A1B2C3: [回复#11] 在吗 [表情:呲牙] [图片]
#13 [私聊 21:33] 你: 在的
[系统] 私聊 用户A1B2C3 关闭了你的主动消息
```

`#编号` 是 World 分配的短编号，对应一条 QQ 消息，工具里的 `reply_to`、`message`、`before` 都填它。私聊和群聊只有 OpenID，行里显示尾号；频道显示昵称。小黄脸按表情名渲染，引用已记录的消息写 `[回复#编号]`，未记录的直接带出原文。附件按类型显示 `[图片]`、`[语音]`、`[视频 文件名]`、`[文件 文件名]`。发送回执写成 `[sent #编号 → 会话, 被动回复]`，结果里注明实际按被动回复、主动消息还是召回消息发出，以及发生过的降级。环境提示词列出已知会话和它们的地址。

每条消息携带发送目标 `target`，工具中的地址写作 `c2c:<OpenID>`、`group:<群 OpenID>`、`channel:<子频道 ID>`、`dms:<guild_id>`：

| `target.kind` | `target.id` |
| --- | --- |
| `c2c` | `author.user_openid` |
| `group` | `group_openid` |
| `channel` | `channel_id` |
| `dms` | 该频道私信的私有 `guild_id` |

消息按平台事件类型、目标和消息 ID 去重；其他事件有事件 ID 时按事件 ID 去重。内存最多保留一万条去重标识，启动时从最近一万条 World 存档事件恢复。WebSocket 在当前 World 实例内重连时使用最后已保存的序号恢复；进程重启后创建新的网关会话。

发送序号预留 `qqbot.attempt` 以及平台回执 `qqbot.sent`、`qqbot.removed`、`qqbot.acknowledged` 均以 `deliver: false` 存档，因此不会再次唤醒 Persona。发送记录包含请求和平台响应；平台接受请求不代表收件人已读。HTTP 401 会触发一次刷新凭证后的重试。明确的限流最多重试两次，单次等待不超过五秒。自动降级仅处理明确拒绝：回复依据过期后改为主动发送、Markdown 权限不足后改为纯文本。内容审核拒绝、权限或额度不足不会被绕过。超时、HTTP 5xx 或响应缺少消息 ID 时保留“发送结果未知”，不自动重发。

## 工具

| 工具 | 契约 |
| --- | --- |
| `qqbot_send_message` | 发送文字，可带一张图片（`image`）或单独一条语音（`voice`），取值为 `log:`/`mem:` 句柄或公网 URL；`quote=true` 显示引用；可带平台原生键盘对象。 |
| `qqbot_send_media` | 发送视频、文件或多张图片：公开 URL 或宿主管理的 `log:`/`mem:` 附件，二者选一；不接受本地路径；类型 1 图片、2 视频、3 语音、4 文件；`items` 可顺序发送至多 8 项。 |
| `qqbot_stream_message` | `followModel=true` 将下一轮模型公开正文发送到选定目标；也支持手动 C2C 分片。 |
| `qqbot_delete_message` | 撤回指定目标中机器人发送的消息。 |
| `qqbot_list_targets` | 列出当前 AppID 的已知会话、近期回复依据和主动接收状态。 |
| `qqbot_read_history` | 按行返回当前 AppID 的消息历史，可按会话（`to`）筛选，`before` 填编号往前翻。 |
| `qqbot_read_attachment` | 按消息编号和从 1 开始的附件序号读取内容；`quoted=true` 读引用消息里的附件，语音转换为 WAV 后交给 Core。 |
| `qqbot_ack_interaction` | 使用 0 至 5 的结果码明确确认平台互动事件。 |

地址写在 `to`；`reply_to` 填消息编号，回复那一条并沿用它的会话，省略 `to`。没有记录的编号按 QQ 消息 ID 原样作为回复依据。回复事件使用 `eventId`，与 `reply_to` 互斥。`delivery` 支持 `reply`、`proactive`、`auto`、`wakeup`：`auto` 在保守的近期窗口和已使用序号范围内选取回复依据，否则主动发送；`wakeup` 仅用于 QQ 单聊，由 QQ 判定唤醒权限。省略 `delivery` 和回复依据时按 `auto` 处理。已知主动接收关闭或已删除机器人的目标会被本地拒绝，普通被动回复不受这一检查限制。目标状态、发送序号从当前账号的事件存档恢复。

定时通知复用宿主已有的 `alarm_set`、`alarm_list`、`alarm_cancel`；提醒内容保存 `qqbot_list_targets` 返回的会话地址，唤醒后调用发送工具并指定 `delivery=proactive`。扩展不另起调度器。默认在上次主动发送尝试结束后等待三秒，再发起下一次；被拒绝的请求和降级重试同样受此间隔限制。QQ 的权限、配额和接收方设置仍可能拒绝请求。

`followModel=true` 必须明确选择目标；下一轮只转发公开正文，不包含推理和工具参数。带回复依据的 C2C 按间隔发送，主动通知、群、频道和频道私信缓冲后发普通消息；流式接口明确返回 404/405 时也缓冲降级。轮次结束、调用其他工具、取消、切换会话或空闲超时会结束流。手动 C2C 分片使用 `content`，续片沿用返回的 `streamId`，`finish` 默认为 true，目标、格式、回复依据和序号保持不变。已发送内容不会因后续失败而整段重发；结果未知的续片会在进程重启后继续禁止重放。

附件读取只接受 `qq.com`、`qq.com.cn`、`qpic.cn`、`ugcimg.cn` 及其子域的 HTTPS 地址，每次重定向重新校验，下载请求不携带机器人认证头。Core 按当前模型能力决定是否传递对应 MIME 类型；仅有 URL 和元数据不会被视为已经看见或听见附件。

频道和频道私信支持文本、Markdown、远程图片及宿主附件图片的 multipart 上传，C2C 与群聊支持图片、语音、视频和文件。上传读取和附件下载默认上限为 100 MiB；发送还受图片 30 MiB、语音 20 MiB、视频和文件 100 MiB 的本地上限约束，QQ 可另行收紧。5 MiB 起使用平台分块上传协议，校验完整分块计划、逐块确认后合并，并按平台 TTL 缓存文件句柄。批量发送遇错即停止，返回已成功项与失败位置，避免整批重发。

出站语音通过 FFmpeg 转为 24 kHz 单声道 PCM，再编码为 Tencent SILK；入站 SILK 和常见音频转为 WAV，最多十分钟。FFmpeg 缺失或格式损坏会明确报错。音频 URL 下载校验公网地址并固定 DNS 解析，每次重定向重新检查；解码器禁用嵌套文件和网络协议。扩展不内置语音识别，Core 决定当前模型能否读取音频。互动确认仍需明确调用工具，并满足 QQ 的确认时限。

从 **0.2.3** 起，`qqbot_send_media` 只接收公开 HTTP(S) URL 或 Core 管理的已有 `log:` / `mem:` 附件，不再打开模型指定的文件系统路径。旧的 `path` 参数、`file:` URL、伪装成附件句柄的路径穿越会被拒绝，批量发送同样受限。`fileName` 仅作为显示名称。FFmpeg 仅通过标准输入接收音频字节，并只启用 `pipe` 协议；模型不能指定命令或转码参数。

发送本地图片、音频、视频或文档时，请先通过宿主的附件流程上传，或使用宿主工具生成的附件，再把返回的 `log:` / `mem:` 句柄传给 `blob`，原文件名传给 `fileName`，并指定 `fileType`（1 图片、2 视频、3 语音、4 文件）。语音转码、频道图片上传、分块上传和批量发送均保留。原先使用 `path` 的脚本需要改用 `blob` 或公开 `url`，扩展不提供开启任意文件读取的选项。

## 配置

以下配置位于 `worlds.qqbot`，默认值和校验见 [`src/config.ts`](src/config.ts)。

| 配置 | 默认值 | 生效方式 |
| --- | --- | --- |
| `enabled` | `false` | 由宿主启用或停用。 |
| `appId` | 空 | 机器人身份，重启后生效。 |
| `transport` | `websocket` | `websocket` 或 `webhook`，重启后生效。 |
| `sandbox` | `false` | QQ 沙箱 API 地址，重启后生效。 |
| `intents` | `33554432` | 网关事件订阅位掩码，重启后生效。 |
| `webhook.host`、`port`、`path` | `127.0.0.1`、`6196`、`/qqbot/callback` | 监听地址，重启后生效。 |
| `webhook.maxBodyBytes` | `1048576` | 回调字节数上限，重启后生效。 |
| `timeoutMs` | `20000` | 网络请求超时毫秒数，重启后生效。 |
| `reconnectMs`、`maxReconnectMs` | `1000`、`30000` | 网关重连退避的毫秒数范围，重启后生效。 |
| `maxMediaBytes` | `104857600` | 附件读取上限；上传还受媒体类型限制，立即生效。 |
| `autoFallback` | `true` | 明确拒绝后自动降级；单次工具可用 `fallback=false` 禁用。 |
| `proactiveIntervalMs` | `3000` | 主动消息最小间隔。 |
| `streamIntervalMs` | `500` | 流式分片最小间隔。 |
| `streamIdleMs` | `15000` | 流式空闲收尾时间。 |
| `ffmpegPath` | `ffmpeg` | 音频转码程序路径。 |
| `modelLanguage` | `zh` | 模型文本使用中文或英文，立即生效。 |

操作界面支持 Cortico 的十一种语言。模型文本位于 `src/model-text.ts`，界面文案位于 `src/strings.ts`。

## 开发与分发

`pnpm describe` 重新生成 `describe.json`；`pnpm check:extension` 使用 SDK 的 manifest、构造和能力声明校验器，不启动连接。发布版 SDK 缺少可选依赖的内建 World 会跳过工具名称冲突检查，并显示提示。包元数据遵循 [Cortico 扩展市场](https://github.com/Pal-AI-Lab/cortico-extensions) 的规范；向该市场登记和发布 npm 包是独立操作。

发布 GitHub Release 会运行 [release 工作流](.github/workflows/release.yml)：校验并构建项目，将主包和 API 5 兼容包附加到 Release，然后将主包发布到 npm，并生成来源证明（provenance）。草稿 Release 不会触发发布。Release 标签必须与 `v<package.json 中的版本号>` 完全一致，例如 `v0.2.1`。正式版本使用 npm 的 `latest` 标签；GitHub 预发布版本或版本号包含预发布后缀时使用 `next`。API 5 兼容包仅作为 GitHub Release 附件分发。

首次自动发布前，在 npm 包的设置中配置 [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/)：

- Provider：**GitHub Actions**
- Organization or user：`Pal-AI-Lab`
- Repository：`cortico-world-qqbot`
- Workflow filename：`release.yml`
- Environment name：留空
- Allowed actions：允许通过 `npm publish` 直接发布

工作流在 GitHub 托管的 runner 上使用 OIDC 认证，无需配置 `NPM_TOKEN` Secret。如果 npm 上还没有这个包，需要先从已登录 npm 的本机环境发布一次，再配置 Trusted Publisher。之后每次发版，更新 `package.json` 和 `CHANGELOG.md`，提交后使用对应标签发布 GitHub Release。每次都需使用 npm 上尚未发布的新版本号；工作流不会自动递增版本。

测试使用本机 HTTP/WebSocket 服务器、Ed25519、AES-GCM、Cortico JSONL 事件库和 SDK 浏览器 UI 组件，覆盖回调持久化、重连、去重、主动消息节流与拒收、自动回复流、失败降级、未知结果恢复、分块上传、真实音频编解码、媒体边界、绑定和面板卸载。自动化测试不访问真实 QQ，也不读取操作员部署。真实服务联调单独运行；`experimental` 标签保留，因为不同 QQ 应用的权限与媒体能力仍需逐项验收。

协议参考：[AstrBot QQ Official](https://github.com/AstrBotDevs/AstrBot/tree/master/astrbot/core/platform/sources/qqofficial)、[AstrBot Webhook](https://github.com/AstrBotDevs/AstrBot/tree/master/astrbot/core/platform/sources/qqofficial_webhook) 和 [QQ 官方接口文档](https://bot.q.qq.com/wiki/develop/api-v2/)。本包使用独立的 TypeScript 实现，无需 AstrBot 运行时。

许可证为 AGPL-3.0-or-later，见 [LICENSE](LICENSE)。
