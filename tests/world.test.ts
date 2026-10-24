import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, renameSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolOutcome } from 'cortico/core/types.ts';
import { JsonlEventStore } from 'cortico/core/event-store.ts';
import { QQOfficialWorld } from '../src/world.ts';
import { QQOFFICIAL_DEFAULTS, QQOFFICIAL_SECRET } from '../src/config.ts';
import { TestHost, context, httpServer, json, readBody, SECRET, signedHeaders } from './helpers.ts';

let host: TestHost;
let world: QQOfficialWorld;
let api: Awaited<ReturnType<typeof httpServer>>;
let callback: string;
let ctx: ReturnType<typeof context>;
const messages: Array<{ path: string; body: Record<string, unknown> }> = [];

async function start() {
  world = new QQOfficialWorld({ context: ctx.value, endpoints: { apiUrl: api.url, tokenUrl: `${api.url}/token`, mediaOrigin: api.url } });
  await world.start(host);
  callback = `http://${world.webUi().lamps![0].hint}`;
}

async function incoming(t: string, d: Record<string, unknown>, id = 'event') {
  const body = JSON.stringify({ op: 0, t, id, d });
  return fetch(callback, { method: 'POST', body, headers: signedHeaders(body) });
}

async function tool(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  return world.tools().find((t) => t.name === `qqofficial_${name}`)!.handler(args, { role: 'test', log: host.log, signal });
}

beforeEach(async () => {
  host = new TestHost(); messages.length = 0;
  api = await httpServer(async (req, res) => {
    if (req.url === '/image.png') {
      if (req.headers.authorization || req.headers['x-union-appid']) { res.writeHead(403); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from([137, 80, 78, 71])); return;
    }
    if (req.url === '/token') { json(res, { access_token: 'access', expires_in: 7200 }); return; }
    if (req.headers.authorization !== 'QQBot access') { json(res, { code: 401 }, 401); return; }
    const body = await readBody(req);
    if (req.url!.endsWith('/files')) {
      if (body.srv_send_msg !== false || (!body.url && !body.file_data)) { json(res, { code: 400 }, 400); return; }
      json(res, { file_info: 'uploaded-file', ttl: 3600 }); return;
    }
    messages.push({ path: req.url!, body });
    if (body.content === 'reject') { json(res, { code: 40034105 }, 403); return; }
    json(res, { id: body.stream_msg_id ?? `sent-${messages.length}`, timestamp: '2026-10-24T00:00:00Z' });
  });
  ctx = context({ appId: 'application', transport: 'webhook', webhook: { ...QQOFFICIAL_DEFAULTS.webhook, port: 0 } });
  ctx.secrets.set(QQOFFICIAL_SECRET, SECRET);
  await start();
});

afterEach(async () => { await world?.stop(); await api?.close(); host?.close(); });

describe('event stream integration', () => {
  it('returns attachment bytes through Core and rejects other accounts and absent attachments', async () => {
    await incoming('C2C_MESSAGE_CREATE', { id: 'media', author: { user_openid: 'user' }, attachments: [{ url: 'https://multimedia.nt.qq.com.cn/image.png', filename: 'photo.png' }] });
    const cursor = host.store.range({ source: 'qqofficial' })[0].cursor;
    expect(await tool('read_attachment', { cursor, index: 0 })).toMatchObject({ blobs: [{ bytes: Buffer.from([137, 80, 78, 71]), mime: 'image/png', name: 'photo.png' }] });
    expect(await tool('read_attachment', { cursor, index: 1 })).toMatchObject({ failed: true });
    await world.stop(); ctx.value.cfg.appId = 'other'; await start();
    expect(await tool('read_attachment', { cursor, index: 0 })).toMatchObject({ failed: true });
  });

  it.each([
    ['C2C_MESSAGE_CREATE', { author: { user_openid: 'user' } }, { kind: 'c2c', id: 'user' }],
    ['GROUP_AT_MESSAGE_CREATE', { group_openid: 'group' }, { kind: 'group', id: 'group' }],
    ['GROUP_MESSAGE_CREATE', { group_openid: 'group' }, { kind: 'group', id: 'group' }],
    ['AT_MESSAGE_CREATE', { channel_id: 'channel', guild_id: 'guild' }, { kind: 'channel', id: 'channel' }],
    ['MESSAGE_CREATE', { channel_id: 'channel', guild_id: 'guild' }, { kind: 'channel', id: 'channel' }],
    ['DIRECT_MESSAGE_CREATE', { author: { id: 'member' }, channel_id: 'channel', guild_id: 'private-guild' }, { kind: 'dms', id: 'private-guild' }],
  ])('delivers %s with its API target and raw fields without sending a reply', async (event, fields, target) => {
    const data = { ...fields, id: 'message', content: '  <@bot> hello', attachments: [{ url: 'https://example.invalid/image.png', content_type: 'image/png' }],
      message_scene: { ext: [{ msg_idx: 'reference' }] } };
    expect((await incoming(event, data)).status).toBe(200);
    expect(messages).toEqual([]);
    const saved = host.store.range({ source: 'qqofficial' });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ type: 'qqofficial.message', origin: 'external', meta: { target, data, messageId: 'message', eventId: 'event' } });
    expect(host.pushes[0].options).toMatchObject({ deliver: true, trigger: 'debounce' });
  });

  it('persists unknown notices and deduplicates simultaneous callbacks and callbacks after restart', async () => {
    const requests = await Promise.all([incoming('FRIEND_ADD', { openid: 'user' }), incoming('FRIEND_ADD', { openid: 'user' })]);
    expect(requests.map((r) => r.status)).toEqual([200, 200]);
    await world.stop(); await start();
    expect((await incoming('FRIEND_ADD', { openid: 'user' })).status).toBe(200);
    expect(host.store.range({ source: 'qqofficial' })).toHaveLength(1);
  });

  it('acknowledges only persisted callbacks so a failed disk write can be retried', async () => {
    const file = join(host.dataDir, 'runs', '20261024-000000', 'events.jsonl');
    await incoming('FRIEND_ADD', { openid: 'first' }, 'first');
    renameSync(file, `${file}.saved`); mkdirSync(file);
    expect((await incoming('FRIEND_ADD', { openid: 'second' }, 'second')).status).toBe(503);
    rmdirSync(file); renameSync(`${file}.saved`, file);
    expect((await incoming('FRIEND_ADD', { openid: 'second' }, 'second')).status).toBe(200);
    const reopened = new JsonlEventStore({ dataDir: host.dataDir, run: '20261024-000000' });
    expect(reopened.range({ source: 'qqofficial' }).map((e) => e.meta?.eventId)).toEqual(['first', 'second']);
    expect(host.pushes).toHaveLength(2);
  });
});

describe('outbound actions', () => {
  it('allocates unique reply sequences across concurrent sends and a World restart', async () => {
    const args = { target: { kind: 'group', id: 'destination' }, content: 'reply', replyTo: 'received' };
    await Promise.all([tool('send_message', args), tool('send_message', args)]);
    await world.stop(); await start(); await tool('send_message', args);
    expect(messages.map((m) => m.body.msg_seq)).toEqual([1, 2, 3]);
    expect(messages.every((m) => m.path === '/v2/groups/destination/messages' && m.body.msg_id === 'received')).toBe(true);
    expect(host.pushes.filter((p) => p.event.type === 'qqofficial.sent').every((p) => p.options?.deliver === false)).toBe(true);
  });

  it('keeps DMS guild routing separate from C2C and channel message formats', async () => {
    await tool('send_message', { target: { kind: 'dms', id: 'private/guild' }, content: 'direct', replyTo: 'received' });
    await tool('send_message', { target: { kind: 'channel', id: 'channel' }, content: '**markdown**', format: 'markdown' });
    expect(messages).toEqual([
      { path: '/dms/private%2Fguild/messages', body: { content: 'direct', msg_id: 'received' } },
      { path: '/channels/channel/messages', body: { markdown: { content: '**markdown**' } } },
    ]);
  });

  it('uploads a blob before sending media and supports a remote channel image', async () => {
    host.blobs.set('mem:image', { bytes: Uint8Array.of(1, 2, 3), mime: 'image/png' });
    const result = await tool('send_media', { target: { kind: 'c2c', id: 'user' }, fileType: 1, blob: 'mem:image', replyTo: 'received' });
    expect(typeof result).toBe('string');
    expect(messages[0].body).toMatchObject({ msg_type: 7, media: { file_info: 'uploaded-file' }, msg_id: 'received' });
    await tool('send_media', { target: { kind: 'channel', id: 'channel' }, fileType: 1, url: 'https://example.invalid/image.png' });
    expect(messages[1].body).toEqual({ image: 'https://example.invalid/image.png' });
    expect((await tool('send_media', { target: { kind: 'channel', id: 'channel' }, fileType: 3, blob: 'mem:image' }) as ToolOutcome).failed).toBe(true);
    expect(messages).toHaveLength(2);
  });

  it('reports rejected sends as failures without manufacturing sent events', async () => {
    const rejected = await tool('send_message', { target: { kind: 'c2c', id: 'user' }, content: 'reject' });
    expect(rejected).toMatchObject({ failed: true, text: expect.stringContaining('40034105') });
    expect(host.store.range({ source: 'qqofficial' }).filter((e) => e.type === 'qqofficial.sent')).toEqual([]);
    expect(messages).toHaveLength(1);
  });

  it('validates anchors and cancellation before sending', async () => {
    const args = { target: { kind: 'c2c', id: 'user' }, content: 'hello', replyTo: 'received', eventId: 'event' };
    expect(await tool('send_message', args)).toMatchObject({ failed: true });
    const controller = new AbortController(); controller.abort();
    expect(await tool('send_message', { ...args, eventId: undefined }, controller.signal)).toMatchObject({ failed: true });
    expect(messages).toEqual([]);
  });

  it('continues explicit streams across restart and preserves the reply anchor and format', async () => {
    const destination = { kind: 'c2c', id: 'user' };
    const first = await tool('stream_message', { target: destination, content: 'first\n', format: 'markdown', replyTo: 'received', finish: false });
    expect(typeof first).toBe('string');
    const streamId = JSON.parse((first as string).split('\n').slice(1).join('\n')).streamId as string;
    // Simulate a process interruption: graceful shutdown now closes published streams.
    world['abort'].abort();
    await world.stop(); await start();
    await tool('stream_message', { target: destination, streamId, content: 'last\n' });
    expect(messages.map((m) => m.body)).toMatchObject([
      { index: 0, input_state: 1, content_type: 'markdown', content_raw: 'first\n', msg_id: 'received', msg_seq: 1 },
      { index: 1, input_state: 10, content_type: 'markdown', stream_msg_id: streamId, content_raw: 'last\n', msg_id: 'received', msg_seq: 1 },
    ]);
    expect(await tool('stream_message', { target: destination, streamId, content: 'extra' })).toMatchObject({ failed: true });
    expect(messages).toHaveLength(2);
  });

  it('history stays within the account and requested target', async () => {
    await incoming('C2C_MESSAGE_CREATE', { id: 'one', author: { user_openid: 'a' }, content: 'one' }, 'one');
    await incoming('C2C_MESSAGE_CREATE', { id: 'two', author: { user_openid: 'b' }, content: 'two' }, 'two');
    const history = JSON.parse(await tool('history', { target: { kind: 'c2c', id: 'a' } }) as string);
    expect(history.map((e: { meta: { messageId: string } }) => e.meta.messageId)).toEqual(['one']);
  });
});
