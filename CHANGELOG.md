<!-- Owner: package.json, src/definition.ts -->

# Changelog

## Unreleased

- Published as `cortico-world-qqbot` by Pal AI Lab. The World id is now `qqbot` (tools `qqbot_*`, events `qqbot.*`, config `worlds.qqbot`, secret `CORTICO_QQBOT_APP_SECRET`); installs of `cortico-world-qq-official` need to bind again.
- The prompt says Coo is connected to a QQ bot entry, lists QQ's limits on it with a way to work with each, and asks Coo to keep stickers in its memory under descriptive names and send them often.
- Send receipts state the delivery mode and what remains: replies left on the message and minutes left, or the rule that made a message proactive. Platform rejections carry a plain explanation of the limit they hit.
- A refused proactive message in a direct chat (40054013 or 40034105) is sent once as the period's wakeup message; a recipient who turned proactive messages off gets the wakeup message directly.
- An @ in a group or channel wakes the model at once; direct chats still batch.
- Render faces written in the older `[<face,id=13/>]` form.
- QR binding follows QQ's three-minute task lifetime and renews an expired code up to three times in a row. Scanned credentials are checked for a token before they are saved; a secret that yields none asks for a new scan that creates a new bot.

- Render model-facing text in the shape of Cortico's built-in QQ World: one line per message (`#n [conversation HH:MM] sender: text`) with faces by name, quotes, mentions and attachment placeholders; notices, send receipts and history as short lines instead of raw JSON. Original fields stay in `meta.data`.
- Address tools with `to` (`c2c:<OpenID>` and so on) and short message numbers: `reply_to`, `message` and `before` take `#n`. `send_message` takes `text` plus an optional `image` or `voice`; `history` is now `read_history`; `read_attachment` takes a message number and a 1-based index. Object targets from earlier reminders are still accepted.
- List known conversations and the bot's QQ name in the environment prompt.
- Fetch images from the QQ CDN as messages arrive and attach them to the event when the model accepts images; voice without a QQ transcript is converted to WAV and attached when the model accepts audio. Downloads that take longer than 2.5 seconds follow as a `qqofficial.attachment` event. Video and files are still read on request.
- Keep automatic C2C reply anchors for 30 minutes. QQ documents a 60-minute, 4-reply window for direct chats, and a reply 31 minutes after the message was confirmed on a phone; 30 minutes leaves margin. Groups and channels keep the 5-minute window.
- Default `delivery` to `auto`: a message without `reply_to` replies to the latest message in that conversation that still accepts a reply, and is sent proactively only when none does. `delivery=proactive` still forces a proactive message.

## 0.2.3

- Close model-directed local filesystem access: media now accepts host-managed `log:` / `mem:` attachments or public HTTP(S) URLs. Legacy `path` inputs are rejected and must migrate to `blob` or `url`.
- Reject path traversal, encoded filesystem paths and file URLs before resolving attachments or starting a media batch. Display filenames never select a local file.
- Preserve image, voice, video and document sends, channel multipart images, batching, chunked uploads and FFmpeg/SILK conversion. Add regression coverage for attachment sends and attempts to read local files through paths, handles or audio playlists.
- Withdraw the package’s `unsafe` declaration for 0.2.3; market warning removal requires approval from the Cortico maintainers.

## 0.2.2

- Complete the market listing with a display name, project icon, three panel previews, bilingual feature descriptions, author profile, homepage and discovery keywords.
- Add illustrated English and Chinese READMEs, with links to installation, support and release notes.
- Keep the API 6 runtime and API 5 compatibility implementation unchanged from the verified 0.2.0 release.

## 0.2.0

- Add persistent target discovery, proactive reception checks, delivery modes, throttling and host alarm guidance.
- Keep proactive cooldowns after slow authentication, responses and rejections, and apply them to fallback retries.
- Add local and batch media, Tencent chunked upload with TTL caching, channel multipart images, FFmpeg/SILK voice conversion and quoted attachment reads.
- Forward explicitly selected model replies through the existing World output tap, with chunk throttling, conversation isolation and automatic stream completion; buffer proactive notifications through the regular message API.
- Downgrade explicit expired-anchor, Markdown and unsupported-stream rejections; bound rate retries and preserve uncertain delivery across restarts without replaying content.
- Extend protocol, streaming and real codec regression coverage for API 6 and Coopanion’s API 5 runtime; update model instructions, localized settings and package metadata.
- Document npm installation and declare the Cortico tags for FFmpeg setup and local-file media access.

## 0.1.1

- Redesign Connection around an embedded QR code, automatic credential retrieval, and live connection status; remove the QR after authorization.
- Move manual credentials and transport settings to Configuration, keeping AppSecret in the deployment secret store.
- Resume pending binding tasks after a page reload and enable or reconnect the World after authorization.
- Cover QR decoding, automatic binding, configuration validation and panel lifecycle on API 6 and Coopanion's API 5 runtime.

## 0.1.0

- Deliver QQ Official gateway and signed Webhook messages and notices through Core's event stream.
- Add explicit message, media, C2C streaming, recall, history, attachment-read and interaction tools.
- Support QQ bot credential binding and manual credential configuration in eleven UI languages.
- Ship World API 6 metadata, a generated self-description and an API 5 compatibility package.
- Mark the release experimental pending live QQ validation.
