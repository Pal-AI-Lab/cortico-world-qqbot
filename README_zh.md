<!-- Owner: src/definition.ts, src/world.ts, src/config.ts, package.json -->

# cortico-world-qq-official

[English](README.md)

通过 QQ 官方接口接入 Cortico 的 World 扩展。使用 WebSocket 网关或签名 Webhook 接收事件，向 Persona 提供消息工具。支持手动填写凭证，也支持 QQ 官方机器人绑定页面。

World ID 为 `qqofficial`，可与使用其他协议、ID 为 `qq` 的 `cortico-world-qq` 共存。每份部署支持配置一个 QQ 机器人。

## 安装

需要 Node.js 22 或更高版本。主包使用 **Cortico World API 6**，开发依赖固定为 `cortico@0.2.6` SDK。

在源码目录运行：

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm verify
```

在 Cortico 或 Coopanion 扩展页选择 **World → 本机目录**，选择本仓库，重启 Core 后加载。运行 `npm pack --ignore-scripts` 可生成包含运行源码、浏览器面板和能力声明的安装包。

宿主仍使用 **World API 5** 时，包括 Cortico 固定在 `88a5e4ddfd8504eee8eb6353d7a9aab9f0e455be` 的 Coopanion，运行：

```sh
pnpm pack:api5
```

在扩展页选择生成的 `dist/api5` 目录。该命令同时生成 `dist/cortico-world-qq-official-0.1.0-api5.tgz`。兼容包调整入口、manifest 契约版本和 WebUI 方法名，传输与工具使用同一份实现。修改源码后需要重新生成。

## 接入

打开 QQ Official World 页面。可以填写 AppID、AppSecret 并保存，也可以选择「获取绑定链接」，打开 QQ 官方页面完成绑定，再选择「查询绑定结果」。绑定任务有效期为十分钟。绑定密钥和解密后的 AppSecret 留在 Core 端，浏览器只收到任务链接和完成状态。

绑定链接使用 QQ 官方的 `/qqbot/openclaw/connect.html` 页面。本扩展属于 Cortico，与 OpenClaw 项目无关，只复用 QQ 开放的绑定和机器人接口，不依赖或集成 OpenClaw。绑定取得机器人的 AppID 和 AppSecret 后，消息收发直接调用 QQ 官方接口，不会连接或控制 OpenClaw 实例。

AppID 保存到 `worlds.qqofficial.appId`；AppSecret 通过 `WorldContext.storeSecret` 保存为部署环境中的 `CORTICO_QQOFFICIAL_APP_SECRET`。AppID 不变时，AppSecret 留空会保留已有值；更换 AppID 必须同时提供新的 AppSecret。保存后启用或重启 World。

默认传输方式为 `websocket`，Intents 为 `33554432`，用于 QQ 群和单聊事件。其他事件需要根据机器人获批的订阅范围设置 Intents。主动消息、Markdown、键盘、媒体和撤回仍受 QQ 平台权限与额度限制。

使用 Webhook 时，将 `transport` 设置为 `webhook`，让 QQ 回调 URL 指向配置的路径。默认监听 `127.0.0.1:6196/qqofficial/callback`，通过 HTTPS 反向代理提供公网入口。验证请求使用官方 Ed25519 握手；事件验签使用原始请求体。Core 保存事件成功后才返回确认，保存失败返回 HTTP 503，供平台重试。Webhook 的连接状态表示本地服务器已监听，不代表已经收到 QQ 回调。

## 事件流

消息投递为 `qqofficial.message`，互动、关系变化及其他平台事件投递为 `qqofficial.notice`。两者均为 `origin: external`、`trigger: debounce`；Core 负责保存和批处理，Persona 决定是否行动。原始正文、提及、引用、附件和 `message_scene` 保留在 `meta.data`。

每条消息携带发送目标 `target`：

| `target.kind` | `target.id` |
| --- | --- |
| `c2c` | `author.user_openid` |
| `group` | `group_openid` |
| `channel` | `channel_id` |
| `dms` | 该频道私信的私有 `guild_id` |

消息按平台事件类型、目标和消息 ID 去重；其他事件有事件 ID 时按事件 ID 去重。内存最多保留一万条去重标识，启动时从最近一万条 World 存档事件恢复。WebSocket 在当前 World 实例内重连时使用最后已保存的序号恢复；进程重启后创建新的网关会话。

发送序号预留 `qqofficial.attempt` 以及平台回执 `qqofficial.sent`、`qqofficial.removed`、`qqofficial.acknowledged` 均以 `deliver: false` 存档，因此不会再次唤醒 Persona。发送记录包含请求和平台响应；平台接受请求不代表收件人已读。仅明确的 HTTP 401 会触发一次刷新凭证后的重试，超时和其他发送失败不会自动重发。

## 工具

| 工具 | 契约 |
| --- | --- |
| `qqofficial_send_message` | 发送文本或 Markdown，可携带消息引用和平台原生键盘对象。 |
| `qqofficial_send_media` | 发送公开 URL 或已有 `log:`/`mem:` 附件；类型 1 图片、2 视频、3 语音、4 文件。 |
| `qqofficial_stream_message` | 向 C2C 发送明确指定的追加分片；续片沿用返回的 `streamId`，`finish` 默认为 true。 |
| `qqofficial_delete_message` | 撤回指定目标中机器人发送的消息。 |
| `qqofficial_history` | 查询当前 AppID 的 World 存档，可按目标和游标筛选。 |
| `qqofficial_read_attachment` | 按已存档事件游标和从 0 开始的序号读取附件，将字节交给 Core。 |
| `qqofficial_ack_interaction` | 使用 0 至 5 的结果码明确确认平台互动事件。 |

回复消息使用 `replyTo`，回复事件使用 `eventId`，两者互斥；都不传时为主动发送。World 不会自动选取最近一条消息作为回复依据。流式续片保留原始目标、格式、回复依据和消息序号。

附件读取只接受 `qq.com`、`qq.com.cn`、`qpic.cn`、`ugcimg.cn` 及其子域的 HTTPS 地址，每次重定向重新校验，下载请求不携带机器人认证头。Core 按当前模型能力决定是否传递对应 MIME 类型；仅有 URL 和元数据不会被视为已经看见或听见附件。

频道和频道私信支持文本、Markdown 和远程图片，C2C 与群聊还支持平台媒体上传接口。本地附件上传和附件下载默认限制为 10 MiB，最多可配置为 20 MiB。本版本不包含分片上传、语音转码、语音识别或模型输出的自动转发；流式发送只使用工具参数中明确给出的内容。互动确认也需要明确调用工具，应满足 QQ 的确认时限。

## 配置

以下配置位于 `worlds.qqofficial`，默认值和校验见 [`src/config.ts`](src/config.ts)。

| 配置 | 默认值 | 生效方式 |
| --- | --- | --- |
| `enabled` | `false` | 由宿主启用或停用。 |
| `appId` | 空 | 机器人身份，重启后生效。 |
| `transport` | `websocket` | `websocket` 或 `webhook`，重启后生效。 |
| `sandbox` | `false` | QQ 沙箱 API 地址，重启后生效。 |
| `intents` | `33554432` | 网关事件订阅位掩码，重启后生效。 |
| `webhook.host`、`port`、`path` | `127.0.0.1`、`6196`、`/qqofficial/callback` | 监听地址，重启后生效。 |
| `webhook.maxBodyBytes` | `1048576` | 回调字节数上限，重启后生效。 |
| `timeoutMs` | `20000` | 网络请求超时毫秒数，重启后生效。 |
| `reconnectMs`、`maxReconnectMs` | `1000`、`30000` | 网关重连退避的毫秒数范围，重启后生效。 |
| `maxMediaBytes` | `10485760` | 本地附件上传和附件下载的字节数上限，立即生效。 |
| `modelLanguage` | `zh` | 模型文本使用中文或英文，立即生效。 |

操作界面支持 Cortico 的十一种语言。模型文本位于 `src/model-text.ts`，界面文案位于 `src/strings.ts`。

## 开发与分发

`pnpm describe` 重新生成 `describe.json`；`pnpm check:extension` 使用 SDK 的 manifest、构造和能力声明校验器，不启动连接。发布版 SDK 缺少可选依赖的内建 World 会跳过工具名称冲突检查，并显示提示。包元数据遵循 [Cortico 扩展市场](https://github.com/Pal-AI-Lab/cortico-extensions) 的规范；向该市场登记和发布 npm 包是独立操作。

测试使用本机 HTTP/WebSocket 服务器、Ed25519、AES-GCM、Cortico JSONL 事件库和 SDK 浏览器 UI 组件，覆盖回调持久化、重试、重启去重、发送序号、流式消息、媒体边界、绑定和面板卸载。测试不访问真实 QQ，也不读取操作员部署。真实机器人联调完成前，扩展保留 `experimental` 标签。

协议参考：[AstrBot QQ Official](https://github.com/AstrBotDevs/AstrBot/tree/master/astrbot/core/platform/sources/qqofficial)、[AstrBot Webhook](https://github.com/AstrBotDevs/AstrBot/tree/master/astrbot/core/platform/sources/qqofficial_webhook) 和 [QQ 官方接口文档](https://bot.q.qq.com/wiki/develop/api-v2/)。本包使用独立的 TypeScript 实现，无需 AstrBot 运行时。

许可证为 AGPL-3.0-or-later，见 [LICENSE](LICENSE)。
