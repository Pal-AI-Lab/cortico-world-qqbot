import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { OutputTap, ToolOutcome } from 'cortico/core/types.ts';
import { LogBlobStore } from 'cortico/core/blobs.ts';
import { QQOfficialWorld } from '../src/world.ts';
import { QQOFFICIAL_DEFAULTS, QQOFFICIAL_SECRET } from '../src/config.ts';
import { audioToSilk, isSilk, pcmToWav } from '../src/audio.ts';
import { TestHost, context, httpServer, json, readBody, SECRET, signedHeaders } from './helpers.ts';

let host: TestHost;
let world: QQOfficialWorld;
let ctx: ReturnType<typeof context>;
let api: Awaited<ReturnType<typeof httpServer>>;
let mode = '';
let tokenDelayMs = 0;
let messageDelayMs = 0;
let incomingMedia: Uint8Array;
const uploads: Record<string, unknown>[] = [];
const requests: Array<{ path: string; body: Record<string, unknown>; at: number }> = [];
async function start() {
  world = new QQOfficialWorld({ context: ctx.value, endpoints: { apiUrl: api.url, tokenUrl: `${api.url}/token`, mediaOrigin: api.url } });
  await world.start(host);
}
async function tool(name: string, args: Record<string, unknown>) {
  return world.tools().find(t => t.name === `qqbot_${name}`)!.handler(args, { role: 'test', log: host.log });
}
async function event(t: string, d: Record<string, unknown>) {
  const body = JSON.stringify({ op: 0, t, d, id: `${t}-${Date.now()}-${Math.random()}` });
  const response = await fetch(`http://${world.webUi().lamps![0].hint}`, { method: 'POST', body, headers: signedHeaders(body) });
  expect(response.status).toBe(200);
}
function emit(value: Record<string, unknown>) { world.outputTap()!.onEvent(value as unknown as Parameters<OutputTap['onEvent']>[0]); }
const destination = 'c2c:user';

beforeEach(async () => {
  host = new TestHost(); requests.length = 0; uploads.length = 0; mode = ''; incomingMedia = new Uint8Array();
  tokenDelayMs = 0; messageDelayMs = 0;
  api = await httpServer(async (req, res) => {
    if (req.url === '/token') {
      if (tokenDelayMs) await delay(tokenDelayMs);
      json(res, { access_token: 'token', expires_in: 7200 }); return;
    }
    if (req.url === '/voice') { expect(req.headers.authorization).toBeUndefined(); res.setHeader('Content-Type', 'application/octet-stream'); res.end(incomingMedia); return; }
    expect(req.headers.authorization).toBe('QQBot token');
    let body: Record<string, unknown>;
    if (String(req.headers['content-type']).startsWith('multipart/form-data')) {
      const parts: Buffer[] = []; for await (const part of req) parts.push(part);
      body = { multipart: Buffer.concat(parts).toString() };
    } else body = await readBody(req);
    if (req.url!.endsWith('/files')) { uploads.push(body); json(res, { file_info: 'media', ttl: 30 }); return; }
    requests.push({ path: req.url!, body, at: Date.now() });
    if (messageDelayMs) await delay(messageDelayMs);
    if (mode === 'no-stream' && req.url!.endsWith('/stream_messages')) { json(res, { code: 404 }, 404); return; }
    if (mode === 'stream-rejected' && Number(body.index) > 0 && String(body.content_raw ?? '').trim()) { json(res, { code: 40034006 }, 403); return; }
    if (body.content_type === 'markdown' && body.input_state === 10 && !String(body.content_raw).endsWith('\n')) { json(res, { code: 400, message: '流式消息md分片需要以换行结束' }, 400); return; }
    if (mode === 'empty') { json(res, {}); return; }
    if (mode === 'server-error' || (mode === 'stream-error' && Number(body.index) > 0)) { json(res, { code: 50001 }, 500); return; }
    if (mode === 'rate') { res.setHeader('Retry-After', '0'); json(res, { code: 50002 }, 429); return; }
    if (body.content === 'reject') { json(res, { code: 40034006 }, 403); return; }
    if ((mode === 'refused' && !body.msg_id && !body.is_wakeup) || (mode === 'refused-all' && !body.msg_id)) { json(res, { code: 40054013 }, 403); return; }
    if ((mode === 'anchor' || mode === 'both') && body.msg_id) { json(res, { code: 304103 }, 400); return; }
    if ((mode === 'markdown' || mode === 'both') && (body.markdown || body.content_type === 'markdown')) { json(res, { code: 40034127 }, 403); return; }
    json(res, { id: body.stream_msg_id ?? `sent-${requests.length}` });
  });
  ctx = context({ appId: 'app', transport: 'webhook', webhook: { ...QQOFFICIAL_DEFAULTS.webhook, port: 0 } });
  ctx.secrets.set(QQOFFICIAL_SECRET, SECRET); await start();
});
afterEach(async () => { await world.stop(); await api.close(); host.close(); });

describe('proactive delivery and known targets', () => {
  it('discovers opt-out state, restores it after restart and separates accounts', async () => {
    await event('C2C_MESSAGE_CREATE', { id: 'in', author: { user_openid: 'user', username: 'Alice' }, content: 'hello' });
    await event('C2C_MSG_REJECT', { openid: 'user' });
    expect(await tool('list_targets', {})).toBe('- 私聊 Alice(c2c:user) 可以被动回复, 对方关闭了主动消息');
    await world.stop(); await start();
    expect(await tool('send_message', { to: destination, text: 'hi', delivery: 'proactive' })).toMatchObject({ failed: true });
    expect(requests).toHaveLength(0);
    expect(typeof await tool('send_message', { to: destination, text: 'reply', delivery: 'reply' })).toBe('string');
    expect(requests[0].body.msg_id).toBe('in');
    await world.stop(); ctx.value.cfg.appId = 'other'; await start();
    expect(await tool('list_targets', {})).toBe('还没有人在 QQ 上跟你说过话。');
  });

  it('supports C2C/group proactive sends, wakeup and cached auto-reply budgets', async () => {
    await event('C2C_MESSAGE_CREATE', { id: 'in', author: { user_openid: 'user' } });
    for (let n = 0; n < 5; n++) await tool('send_message', { to: destination, text: 'auto', delivery: 'auto' });
    expect(requests.slice(0, 4).map(r => r.body.msg_seq)).toEqual([1, 2, 3, 4]);
    expect(requests[4].body.msg_id).toBeUndefined();
    await tool('send_message', { to: 'group:group', text: 'active', delivery: 'proactive' });
    expect(requests.at(-1)).toMatchObject({ path: '/v2/groups/group/messages', body: { content: 'active', msg_type: 0 } });
    await tool('send_message', { to: destination, text: 'recall', delivery: 'wakeup' });
    expect(requests.at(-1)!.body).toMatchObject({ is_wakeup: true });
    expect(requests.at(-1)!.body.msg_id).toBeUndefined();
    expect(await tool('send_message', { to: destination, text: 'bad', delivery: 'proactive', reply_to: 'in' })).toMatchObject({ failed: true });
  });

  it('states the reply budget and names the limit once it is used up', async () => {
    await event('C2C_MESSAGE_CREATE', { id: 'in', author: { user_openid: 'user' } });
    const receipts = [];
    for (let n = 0; n < 5; n++) receipts.push(await tool('send_message', { to: destination, text: 'hi' }));
    expect(receipts[2]).toMatch(/被动回复。这条消息还能回 1 次，还剩 30 分钟\]$/);
    expect(receipts[3]).toMatch(/被动回复。这条消息的回复次数已用完，之后再发就是主动消息\(私聊里对方每发一条消息，30 分钟内最多回复 4 次\)\]$/);
    expect(receipts[4]).toMatch(/主动消息。现在没有还能回复的消息\(私聊里对方每发一条消息，30 分钟内最多回复 4 次\),这条按主动消息发出/);
  });

  it('sends the wakeup message when a direct chat refuses proactive messages', async () => {
    await event('C2C_MESSAGE_CREATE', { id: 'in', author: { user_openid: 'user' }, timestamp: new Date(Date.now() - 40 * 60_000).toISOString() });
    mode = 'refused';
    const receipt = await tool('send_message', { to: destination, text: 'ping' });
    expect(requests.map(r => r.body.is_wakeup)).toEqual([undefined, true]);
    expect(receipt).toMatch(/召回消息。主动消息被拒，改发了召回消息，这一段时间的召回已用掉/);
  });

  it('goes straight to the wakeup message after the recipient turned proactive messages off', async () => {
    await event('C2C_MESSAGE_CREATE', { id: 'in', author: { user_openid: 'user' }, timestamp: new Date(Date.now() - 40 * 60_000).toISOString() });
    await event('C2C_MSG_REJECT', { openid: 'user' });
    expect(typeof await tool('send_message', { to: destination, text: 'ping' })).toBe('string');
    expect(requests.map(r => r.body.is_wakeup)).toEqual([true]);
  });

  it('explains a platform refusal with the limit it hit', async () => {
    mode = 'refused-all';
    const outcome = await tool('send_message', { to: destination, text: 'ping' }) as ToolOutcome;
    expect(outcome).toMatchObject({ failed: true, text: expect.stringMatching(/^\[send failed\] 对方关闭了主动消息，等对方先开口 \(QQ bot API HTTP 403; code=40054013/) });
  });

  it('replies to the latest open message when the model gives only an address', async () => {
    await event('C2C_MESSAGE_CREATE', { id: 'open', author: { user_openid: 'user' } });
    await tool('send_message', { to: destination, text: 'answer' });
    await tool('send_message', { to: 'c2c:stranger', text: 'hello' });
    expect(requests.map(r => r.body.msg_id)).toEqual(['open', undefined]);
  });

  it('keeps a direct-chat reply anchor for half an hour but a group anchor only for minutes', async () => {
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    await event('C2C_MESSAGE_CREATE', { id: 'dm', author: { user_openid: 'user' }, timestamp: twentyMinutesAgo });
    await event('GROUP_AT_MESSAGE_CREATE', { id: 'grp', group_openid: 'group', author: { member_openid: 'm' }, timestamp: twentyMinutesAgo });
    await tool('send_message', { to: destination, text: 'late', delivery: 'auto' });
    await tool('send_message', { to: 'group:group', text: 'late', delivery: 'auto' });
    expect(requests.map(r => r.body.msg_id)).toEqual(['dm', undefined]);
  });

  it.each([
    { name: 'immediate responses', tokenMs: 0, messageMs: 0, firstContent: 'first' },
    { name: 'a cold token', tokenMs: 80, messageMs: 0, firstContent: 'first' },
    { name: 'a slow response', tokenMs: 0, messageMs: 80, firstContent: 'first' },
    { name: 'a slow rejection', tokenMs: 0, messageMs: 80, firstContent: 'reject' },
  ])('serializes proactive sends with the configured interval after $name', async ({ tokenMs, messageMs, firstContent }) => {
    ctx.value.cfg.proactiveIntervalMs = 40;
    tokenDelayMs = tokenMs; messageDelayMs = messageMs;
    const results = await Promise.all([firstContent, 'second'].map(content => tool('send_message', { to: destination, text: content })));
    if (firstContent === 'reject') expect(results[0]).toMatchObject({ failed: true });
    else expect(typeof results[0]).toBe('string');
    expect(typeof results[1]).toBe('string');
    expect(requests).toHaveLength(2);
    expect(requests[1].at - requests[0].at).toBeGreaterThanOrEqual(messageMs + 30);
  });
});

describe('bounded downgrade and failure outcomes', () => {
  it('falls back from an expired reply to proactive, then from rejected Markdown to text', async () => {
    mode = 'both';
    ctx.value.cfg.proactiveIntervalMs = 40;
    const result = await tool('send_message', { to: destination, text: '**hi**', format: 'markdown', reply_to: 'expired' });
    expect(typeof result).toBe('string');
    expect(requests).toHaveLength(3);
    expect(requests[1].body.msg_id).toBeUndefined();
    expect(requests[2].body).toMatchObject({ content: '**hi**', msg_type: 0 });
    expect(requests[2].at - requests[1].at).toBeGreaterThanOrEqual(30);
    const sent = host.store.range({ source: 'qqbot' }).filter(e => e.type === 'qqbot.sent');
    expect(sent).toHaveLength(1);
    expect(sent[0].meta?.fallbacks).toEqual(['proactive', 'text']);
  });

  it.each(['server-error', 'empty'])('never resends when delivery is unknown: %s', async modeName => {
    mode = modeName;
    expect(await tool('send_message', { to: destination, text: 'hi', reply_to: 'in' })).toMatchObject({ failed: true });
    expect(requests).toHaveLength(1);
    expect(host.store.range({ source: 'qqbot' }).filter(e => e.type === 'qqbot.sent')).toHaveLength(0);
  });

  it('does not bypass content rejection or a disabled fallback setting', async () => {
    await tool('send_message', { to: destination, text: 'reject', reply_to: 'in' });
    expect(requests).toHaveLength(1);
    mode = 'markdown';
    await tool('send_message', { to: destination, text: 'md', format: 'markdown', fallback: false });
    expect(requests).toHaveLength(2);
  });

  it('bounds explicit rate-limit retries', async () => {
    mode = 'rate';
    expect(await tool('send_message', { to: destination, text: 'hi' })).toMatchObject({ failed: true });
    expect(requests).toHaveLength(3);
  });
});

describe('media and auxiliary tools', () => {
  it('rejects existing local files and symlinks, including a path mixed with a valid blob', async () => {
    const local = join(host.dataDir, 'private.txt');
    const link = join(host.dataDir, 'alias.txt');
    await writeFile(local, 'private data must not be sent');
    await symlink(local, link);
    host.blobs.set('mem:allowed', { bytes: Buffer.from('shared attachment'), mime: 'text/plain' });
    const lookup = vi.spyOn(host, 'blob');
    for (const path of [local, link, '../private.txt', 'file://' + local, 'C:\\private\\file.txt']) {
      const result = await tool('send_media', { to: destination, fileType: 4, path, blob: 'mem:allowed' }) as ToolOutcome;
      expect(result.failed).toBe(true);
      expect(result.text).toContain('Direct local paths');
    }
    expect(await tool('send_media', { to: destination, fileType: 4, path: local })).toMatchObject({ failed: true });
    expect(lookup).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it.each([
    '/etc/passwd', 'file:///etc/passwd', 'log:/etc/passwd', 'log:../private', 'log:abc/../../private',
    'mem:/etc/passwd', 'mem:../private', 'mem:folder/../../private', 'mem:folder\\..\\private',
    'mem:%2e%2e%2fprivate', 'mem:folder/%252e%252e/private', 'mem:C:/private', 'mem:bad\0name', 'mem:',
  ])('rejects a forged attachment handle before invoking the host: %s', async blob => {
    const lookup = vi.spyOn(host, 'blob');
    expect(await tool('send_media', { to: destination, fileType: 4, blob })).toMatchObject({ failed: true });
    expect(lookup).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('validates every batch source before uploading any item', async () => {
    host.blobs.set('mem:allowed', { bytes: Buffer.from('shared'), mime: 'text/plain' });
    for (const bad of [{ path: '/private.txt' }, { blob: 'mem:../private' }, { url: 'file:///private.txt' }]) {
      expect(await tool('send_media', { to: destination, items: [
        { fileType: 4, blob: 'mem:allowed' }, { fileType: 4, ...bad },
      ] })).toMatchObject({ failed: true });
    }
    expect(uploads).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('never falls back from a missing or oversized host attachment to a filesystem read', async () => {
    host.blobs.set('mem:empty', { bytes: new Uint8Array(), mime: 'text/plain' });
    host.blobs.set('mem:large', { bytes: new Uint8Array(9), mime: 'text/plain' });
    ctx.value.cfg.maxMediaBytes = 8;
    for (const blob of ['mem:missing', 'log:12345678.txt', 'mem:empty', 'mem:large']) {
      expect(await tool('send_media', { to: destination, fileType: 4, blob })).toMatchObject({ failed: true });
    }
    expect(uploads).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it.each([
    { fileType: 1, mime: 'image/png', name: 'picture.png' },
    { fileType: 2, mime: 'video/mp4', name: 'clip.mp4' },
    { fileType: 4, mime: 'application/pdf', name: 'report.pdf' },
  ])('sends both log and memory attachments for fileType $fileType', async ({ fileType, mime, name }) => {
    const store = new LogBlobStore(host.dataDir);
    const bytes = Buffer.from('operator-shared ' + name);
    const log = store.put(bytes, mime);
    host.blobs.set('mem:generated/' + name, { bytes, mime });
    vi.spyOn(host, 'blob').mockImplementation(handle => handle.startsWith('log:') ? store.read(handle) : host.blobs.get(handle) ?? null);
    for (const [index, blob] of [log, 'mem:generated/' + name].entries()) {
      // The filename is display metadata and must never cause a local file read.
      expect(typeof await tool('send_media', { to: 'c2c:user-' + index, fileType, blob, fileName: '/display/only/' + name })).toBe('string');
      expect(uploads[index]).toMatchObject({ file_type: fileType, file_name: name, file_data: bytes.toString('base64') });
    }
    expect(requests).toHaveLength(2);
  });

  it('uploads a Core image blob as multipart in a guild channel', async () => {
    host.blobs.set('mem:picture', { bytes: Buffer.from('image-bytes'), mime: 'image/png' });
    expect(typeof await tool('send_media', { to: 'channel:chan', fileType: 1, blob: 'mem:picture', reply_to: 'in' })).toBe('string');
    expect(requests[0].path).toBe('/channels/chan/messages');
    expect(requests[0].body.multipart).toContain('name="file_image"');
    expect(requests[0].body.multipart).toContain('image-bytes');
  });

  it('reports partial media batches without replaying accepted items', async () => {
    const result = await tool('send_media', { to: destination, items: ['first', 'reject', 'third'].map(content => ({ fileType: 4, url: 'https://example.invalid/test.txt', text: content })) }) as ToolOutcome;
    expect(result.failed).toBe(true);
    expect(result.text.split('\n')).toEqual([expect.stringMatching(/^\[sent #1 → /), expect.stringMatching(/^\[send failed\] 第 2 项:.*前面已发出的不要重发。$/)]);
    expect(requests).toHaveLength(2);
  });

  it('transcodes outgoing WAV blobs and reads quoted incoming SILK as model audio', async () => {
    const wav = pcmToWav(new Uint8Array(24000));
    host.blobs.set('mem:voice', { bytes: wav, mime: 'audio/wav' });
    expect(typeof await tool('send_media', { to: destination, fileType: 3, blob: 'mem:voice', fileName: 'sample.wav' })).toBe('string');
    expect(uploads[0]).toMatchObject({ file_type: 3, file_name: 'sample.silk', srv_send_msg: false });
    expect(isSilk(Buffer.from(String(uploads[0].file_data), 'base64'))).toBe(true);
    incomingMedia = await audioToSilk(wav, { signal: new AbortController().signal, timeoutMs: 5000, ffmpegPath: 'ffmpeg' });
    await event('C2C_MESSAGE_CREATE', { id: 'voice-message', author: { user_openid: 'user' }, msg_elements: [{ attachments: [{ url: 'https://gchat.qpic.cn/voice', filename: 'voice.silk' }] }] });
    const saved = host.store.range({ source: 'qqbot' }).find(e => e.meta?.messageId === 'voice-message')!;
    const outcome = await tool('read_attachment', { message: `#${String(saved.meta!.ref)}`, quoted: true }) as ToolOutcome;
    expect(outcome.failed, outcome.text).not.toBe(true);
    expect(outcome.blobs![0]).toMatchObject({ mime: 'audio/wav', name: 'voice.wav' });
    const blob = outcome.blobs![0];
    expect('bytes' in blob && Buffer.from(blob.bytes).subarray(0, 4).toString()).toBe('RIFF');
  });

  it('hands incoming voice to an audio-capable model without a tool call', async () => {
    host.modelFacts.accepts = (mime: string) => mime === 'audio/wav';
    incomingMedia = await audioToSilk(pcmToWav(new Uint8Array(24000)), { signal: new AbortController().signal, timeoutMs: 5000, ffmpegPath: 'ffmpeg' });
    await event('C2C_MESSAGE_CREATE', { id: 'voice-in', author: { user_openid: 'user' }, attachments: [{ url: 'https://gchat.qpic.cn/voice', content_type: 'voice' }] });
    await vi.waitFor(() => expect(host.pushes.flatMap(p => p.blobs ?? [])).toEqual([expect.objectContaining({ mime: 'audio/wav' })]), { timeout: 10000 });
    const carrier = host.pushes.find(p => p.blobs)!;
    expect(carrier.event.text).toMatch(carrier.event.type === 'qqbot.message' ? /用户user: \[语音\]$/ : /^\[#1 的附件\]$/);
  });

  it('executes recall and interaction confirmation tools', async () => {
    await tool('delete_message', { to: destination, message: 'sent' });
    await tool('ack_interaction', { interactionId: 'click', code: 0 });
    expect(requests.map(r => r.path)).toEqual(['/v2/users/user/messages/sent', '/interactions/click']);
  });
});

describe('model output streaming', () => {
  it('waits for the next response when Core executes the tool eagerly in the calling round', async () => {
    emit({ type: 'response.created', response: { id: 'tool-round' } });
    await tool('stream_message', { to: destination, reply_to: 'in', followModel: true });
    emit({ type: 'response.output_text.delta', delta: 'calling-round text' });
    world.outputTap()!.onRoundEnd!();
    expect(world['replyStream']!.closed).toBe(false);
    emit({ type: 'response.created', response: { id: 'reply-round' } });
    emit({ type: 'response.output_text.delta', delta: 'next-round reply' });
    world.outputTap()!.onRoundEnd!();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toMatchObject({ content_raw: 'next-round reply\n', input_state: 10 });
  });

  it('sends only public deltas to the explicitly selected target and closes at round end', async () => {
    expect(typeof await tool('stream_message', { to: destination, reply_to: 'in', followModel: true })).toBe('string');
    emit({ type: 'response.reasoning.delta', delta: 'private reasoning' });
    emit({ type: 'response.function_call_arguments.delta', delta: 'private tool args' });
    emit({ type: 'response.output_text.delta', delta: '你好' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    emit({ type: 'response.output_text.delta', delta: '，世界' });
    world.outputTap()!.onRoundEnd!();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map(r => r.body.content_raw).join('')).toBe('你好，世界\n');
    expect(requests.map(r => r.body.input_state)).toEqual([1, 10]);
    expect(requests.map(r => r.body.msg_seq)).toEqual([1, 1]);
    expect(requests.every(r => r.body.msg_id === 'in')).toBe(true);
    emit({ type: 'response.output_text.delta', delta: 'later round' });
    await world['outgoing']; expect(requests).toHaveLength(2);
  });

  it.each(['abort', 'tool'])('closes an opened stream on %s without duplicating its text', async reason => {
    await tool('stream_message', { to: destination, reply_to: 'in', followModel: true });
    emit({ type: 'response.output_text.delta', delta: 'once' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    if (reason === 'abort') world.outputTap()!.onAbort!('cancelled');
    else emit({ type: 'response.output_item.added', item: { type: 'function_call', name: 'other_tool' } });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body).toMatchObject({ content_raw: '\n', input_state: 10, index: 1 });
  });

  it('buffers non-C2C output into a normal reply', async () => {
    await tool('stream_message', { to: 'group:group', followModel: true, format: 'text' });
    emit({ type: 'response.output_text.delta', delta: 'one' });
    emit({ type: 'response.output_text.delta', delta: 'two' });
    world.outputTap()!.onRoundEnd!();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ path: '/v2/groups/group/messages', body: { content: 'onetwo' } });
  });

  it('disarms a selected route if another external conversation arrives', async () => {
    await tool('stream_message', { to: destination, followModel: true });
    await host.pushEvent({ type: 'local.message', source: 'local', origin: 'external', text: 'private local conversation', ts: new Date().toISOString() });
    emit({ type: 'response.output_text.delta', delta: 'must stay local' });
    world.outputTap()!.onRoundEnd!(); await world['outgoing'];
    expect(requests).toHaveLength(0);
  });

  it('does not replay partial streams after an uncertain continuation', async () => {
    mode = 'stream-error';
    await tool('stream_message', { to: destination, reply_to: 'in', followModel: true });
    emit({ type: 'response.output_text.delta', delta: 'first' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    emit({ type: 'response.output_text.delta', delta: 'second' });
    world.outputTap()!.onRoundEnd!();
    await vi.waitFor(() => expect(host.store.range({ source: 'qqbot' }).some(e => e.meta?.eventType === 'REPLY_STREAM_FAILED')).toBe(true));
    await world.stop(); await start();
    expect(await tool('stream_message', { to: destination, streamId: 'sent-1', text: 'retry' })).toMatchObject({ failed: true });
    expect(requests).toHaveLength(2);
  });

  it('automatically closes an idle manual stream', async () => {
    ctx.value.cfg.streamIdleMs = 100;
    await tool('stream_message', { to: destination, text: 'first', finish: false });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body.input_state).toBe(10);
  });

  it('buffers the complete reply when the streaming endpoint explicitly does not exist', async () => {
    mode = 'no-stream';
    await tool('stream_message', { to: destination, reply_to: 'in', followModel: true, format: 'text' });
    emit({ type: 'response.output_text.delta', delta: 'first' });
    await vi.waitFor(() => expect(host.store.range({ source: 'qqbot' }).some(e => e.meta?.eventType === 'REPLY_STREAM_BUFFERED')).toBe(true));
    emit({ type: 'response.output_text.delta', delta: ' second' });
    world.outputTap()!.onRoundEnd!();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({ path: '/v2/users/user/messages', body: { content: 'first second' } });
  });

  it('closes a partially sent reply after an explicit rejection without replaying content', async () => {
    mode = 'stream-rejected';
    await tool('stream_message', { to: destination, reply_to: 'in', followModel: true });
    emit({ type: 'response.output_text.delta', delta: 'first' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    emit({ type: 'response.output_text.delta', delta: 'rejected' });
    world.outputTap()!.onRoundEnd!(); world.onTurnEnded();
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].body).toMatchObject({ content_raw: '\n', input_state: 10, index: 1 });
    expect(host.store.range({ source: 'qqbot' }).filter(e => e.type === 'qqbot.sent')).toHaveLength(2);
    await world.stop(); await start();
    expect(world['streams'].size).toBe(0);
  });

  it('delivers proactive C2C model output as one ordinary notification without calling the stream endpoint', async () => {
    const armed = JSON.parse(await tool('stream_message', { to: destination, delivery: 'proactive', followModel: true, format: 'text' }) as string);
    expect(armed.streaming).toBe(false);
    emit({ type: 'response.output_text.delta', delta: 'scheduled ' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(requests).toHaveLength(0);
    emit({ type: 'response.output_text.delta', delta: 'notification' });
    world.outputTap()!.onRoundEnd!();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ path: '/v2/users/user/messages', body: { content: 'scheduled notification' } });
    expect(requests[0].body.msg_id).toBeUndefined();
  });
});
