<!-- Owner: package.json, src/definition.ts -->

# Changelog

## 0.2.1

- Complete the market listing with a display name, original icon, three panel previews, bilingual feature descriptions, author profile, homepage and discovery keywords.
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
