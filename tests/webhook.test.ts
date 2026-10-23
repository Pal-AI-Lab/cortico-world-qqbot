import { afterEach, describe, expect, it } from 'vitest';
import { createPublicKey, verify } from 'node:crypto';
import { QQOfficialWebhook, signingKey } from '../src/webhook.ts';
import { SECRET, signedHeaders } from './helpers.ts';

const running: QQOfficialWebhook[] = [];
afterEach(async () => { await Promise.all(running.splice(0).map((s) => s.stop())); });

async function start(onEvent: ConstructorParameters<typeof QQOfficialWebhook>[0]['onEvent']) {
  const server = new QQOfficialWebhook({ secret: SECRET, host: '127.0.0.1', port: 0, path: '/callback', maxBodyBytes: 1024, onEvent, onError: () => {} });
  running.push(server);
  const port = await server.start();
  return `http://127.0.0.1:${port}/callback`;
}

describe('webhook boundary', () => {
  it('answers the binding challenge with a verifiable signature', async () => {
    const url = await start(async () => { throw new Error('Challenge cannot dispatch'); });
    const response = await fetch(url, { method: 'POST', body: JSON.stringify({ op: 13, d: { plain_token: 'challenge', event_ts: '123' } }) });
    const data = await response.json() as { plain_token: string; signature: string };
    expect(data.plain_token).toBe('challenge');
    expect(verify(null, Buffer.from('123challenge'), createPublicKey(signingKey(SECRET)), Buffer.from(data.signature, 'hex'))).toBe(true);
  });

  it('verifies exact bytes, rejects malformed and oversized payloads, and retries failed persistence', async () => {
    const received: string[] = [];
    const url = await start(async (event) => { if (!received.length) { received.push('failure'); throw new Error('disk full'); } received.push(event.t); });
    const body = JSON.stringify({ op: 0, t: 'FRIEND_ADD', id: 'event', d: { openid: 'user' } });
    const headers = signedHeaders(body);
    expect((await fetch(url, { method: 'POST', body, headers: {} })).status).toBe(401);
    expect((await fetch(url, { method: 'POST', body: body + ' ', headers })).status).toBe(401);
    expect((await fetch(url, { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', body: 'a'.repeat(2048) })).status).toBe(413);
    expect(received).toEqual([]);
    expect((await fetch(url, { method: 'POST', body, headers })).status).toBe(503);
    expect(await (await fetch(url, { method: 'POST', body, headers })).json()).toEqual({ opcode: 12 });
    expect(received).toEqual(['failure', 'FRIEND_ADD']);
  });
});
