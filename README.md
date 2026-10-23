<!-- Owner: src/definition.ts, src/world.ts, src/config.ts, package.json -->

# cortico-world-qq-official

[简体中文](README_zh.md)

A Cortico World for the QQ Official API. It receives QQ events through a WebSocket gateway or signed Webhooks and exposes messaging tools to the Persona. Credentials can be entered manually or obtained through QQ's official bot binding page.

The World uses ID `qqofficial`. It can coexist with `cortico-world-qq`, which uses a different protocol and World ID. One configured QQ bot is supported per deployment.

## Install

Requires Node.js 22 or later. The main package targets **Cortico World API 6** and is developed against the `cortico@0.2.6` SDK.

From a checkout:

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm verify
```

In Cortico or Coopanion's extension page, choose **World → local directory** and select this repository. Restart Core to load the extension. For a portable archive, run `npm pack --ignore-scripts`; the archive contains the runtime source, browser panel and self-description.

For a host that still uses **World API 5**, including Coopanion pinned to Cortico commit `88a5e4ddfd8504eee8eb6353d7a9aab9f0e455be`:

```sh
pnpm pack:api5
```

Select the generated `dist/api5` directory in the extension page. The command also produces `dist/cortico-world-qq-official-0.1.0-api5.tgz`. This fallback changes the entry point, manifest contract and WebUI method name; it uses the same transport and tool implementation. Regenerate it after source changes.

## Connect

Open the QQ Official World page. Either enter AppID and AppSecret and save, or choose **Get binding link**, open QQ's binding page, complete the binding, and choose **Check binding result**. The task expires after ten minutes. The binding key and decrypted secret stay on the Core side; only the task link and completion status reach the browser.

The binding link uses QQ's `/qqbot/openclaw/connect.html` page. This package is a Cortico extension independent of OpenClaw: it reuses QQ's public binding and bot APIs, with no OpenClaw dependency or integration. Binding obtains the bot's AppID and AppSecret; subsequent messaging goes directly to QQ. It does not connect to or control an OpenClaw instance.

The AppID is stored in `worlds.qqofficial.appId`. The secret is stored through `WorldContext.storeSecret` as `CORTICO_QQOFFICIAL_APP_SECRET` in the deployment environment. A blank secret keeps the existing secret only when the AppID is unchanged. Enable or restart the World after saving credentials.

The default transport is `websocket`, with Intents `33554432` for QQ group and C2C events. Set the Intents required by your bot's granted event subscriptions. QQ's permissions and quotas still apply to proactive messages, Markdown, keyboards, media and recalls.

For Webhooks, set `transport` to `webhook` and configure QQ's callback URL to reach the configured path. The default listener is `127.0.0.1:6196/qqofficial/callback`; expose it through your HTTPS reverse proxy. Challenge requests use the official Ed25519 handshake. Event signatures cover the exact request body. An acknowledgement is returned after Core persists the event; failed persistence returns HTTP 503 for platform retry. The Webhook connection lamp reports a listening local server, not successful QQ delivery.

## Event flow

Incoming messages become `qqofficial.message`; interactions, relationship changes and other dispatches become `qqofficial.notice`. Both use `origin: external` and `trigger: debounce`. Core stores and batches them; the Persona decides whether to act. Raw content, mentions, references, attachments and `message_scene` remain in `meta.data`.

Each message carries a routing `target`:

| `target.kind` | `target.id` |
| --- | --- |
| `c2c` | `author.user_openid` |
| `group` | `group_openid` |
| `channel` | `channel_id` |
| `dms` | The direct message's private `guild_id` |

Message IDs are deduplicated per platform event type and target; notices use their event ID when present. The in-memory cache keeps 10,000 identities and is restored from the most recent 10,000 stored World events. WebSocket reconnects resume from the last persisted sequence during the running World instance. A process restart creates a new gateway session.

Outgoing sequence reservations (`qqofficial.attempt`) and platform receipts (`qqofficial.sent`, `qqofficial.removed`, `qqofficial.acknowledged`) are archived with `deliver: false`. Sending therefore does not wake the Persona again. Sent records include the request and platform response; API acceptance does not prove recipient read status. Only an explicit HTTP 401 triggers one authentication retry. Timeouts and other failed sends are not automatically repeated.

## Tools

| Tool | Contract |
| --- | --- |
| `qqofficial_send_message` | Text or Markdown, optional message reference and native keyboard object. |
| `qqofficial_send_media` | Public URL or existing `log:`/`mem:` blob; file types 1 image, 2 video, 3 voice, 4 file. |
| `qqofficial_stream_message` | Explicit C2C append-mode parts. Reuse returned `streamId`; `finish` defaults to true. |
| `qqofficial_delete_message` | Recall a bot message in the given target. |
| `qqofficial_history` | Stored World history for this AppID, optionally filtered by target and cursor. |
| `qqofficial_read_attachment` | Fetch a saved message attachment by event cursor and zero-based index, returning bytes to Core. |
| `qqofficial_ack_interaction` | Explicit platform acknowledgement with a result code from 0 to 5. |

Pass `replyTo` for a message reply or `eventId` for an event reply. They are mutually exclusive. With neither, the send is proactive. The World does not choose a recent message as an implicit reply anchor. Stream continuation retains its original target, format, reply anchor and message sequence.

Attachment reads accept HTTPS URLs on `qq.com`, `qq.com.cn`, `qpic.cn`, `ugcimg.cn` and their subdomains, checking every redirect and omitting bot authentication headers. Core decides whether the current model supports the returned MIME type. URLs and metadata alone are not treated as image or audio perception.

Channels and guild DMs support text, Markdown and remote images. C2C and groups additionally support the platform's media upload interface. Local blob uploads and downloaded attachments default to a 10 MiB limit, configurable up to 20 MiB. This release does not implement chunked uploads, voice transcoding, speech recognition, or automatic forwarding of model output. Streaming sends contain only explicit tool arguments. Interaction acknowledgements also require an explicit tool call, so delivery must meet QQ's acknowledgement deadline.

## Configuration

All keys are under `worlds.qqofficial`. Defaults and validation are in [`src/config.ts`](src/config.ts).

| Key | Default | Effect |
| --- | --- | --- |
| `enabled` | `false` | Host-controlled activation. |
| `appId` | empty | Bot identity; requires restart. |
| `transport` | `websocket` | `websocket` or `webhook`; requires restart. |
| `sandbox` | `false` | QQ sandbox API endpoint; requires restart. |
| `intents` | `33554432` | Gateway event subscription bitmask; requires restart. |
| `webhook.host`, `port`, `path` | `127.0.0.1`, `6196`, `/qqofficial/callback` | Listener address; requires restart. |
| `webhook.maxBodyBytes` | `1048576` | Callback size limit; requires restart. |
| `timeoutMs` | `20000` | Network timeout; requires restart. |
| `reconnectMs`, `maxReconnectMs` | `1000`, `30000` | Gateway reconnect backoff bounds; requires restart. |
| `maxMediaBytes` | `10485760` | Blob upload and attachment download limit; takes effect immediately. |
| `modelLanguage` | `zh` | Model-facing Chinese or English; takes effect immediately. |

The operator panel supports all eleven Cortico UI languages. Model instructions live in `src/model-text.ts`; UI copy lives in `src/strings.ts`.

## Development and distribution

`pnpm describe` regenerates `describe.json`. `pnpm check:extension` runs the SDK's manifest, construction and self-description validators without starting a connection. Optional built-ins missing from the published SDK's dependencies are excluded from tool-name collision checking, with a warning. The package metadata follows the [Cortico extension registry](https://github.com/Pal-AI-Lab/cortico-extensions); registration in that registry and publication to npm are separate operations.

Tests use real local HTTP/WebSocket servers, Ed25519 and AES-GCM, the Cortico JSONL event store, and the SDK's browser UI primitives. They cover callback persistence, retries, restart deduplication, send sequences, streams, media boundaries, binding and panel disposal. No test contacts QQ or uses an operator deployment. This release is tagged `experimental` until checked with a real bot.

Protocol references: [AstrBot QQ Official](https://github.com/AstrBotDevs/AstrBot/tree/master/astrbot/core/platform/sources/qqofficial), [AstrBot Webhook](https://github.com/AstrBotDevs/AstrBot/tree/master/astrbot/core/platform/sources/qqofficial_webhook), and [QQ's API documentation](https://bot.q.qq.com/wiki/develop/api-v2/). This package contains an independent TypeScript implementation; no AstrBot runtime is needed.

Licensed under AGPL-3.0-or-later; see [LICENSE](LICENSE).
