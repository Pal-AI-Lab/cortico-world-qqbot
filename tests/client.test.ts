import { afterEach, describe, expect, it } from 'vitest';
import { QQOfficialClient } from '../src/client.ts';
import { httpServer, json, readBody, SECRET } from './helpers.ts';

const close: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(close.splice(0).map((f) => f())); });

describe('official API transport', () => {
  it('coalesces concurrent token acquisition and refreshes once after a rejected token', async () => {
    let tokens = 0;
    const server = await httpServer(async (req, res) => {
      if (req.url === '/token') {
        expect(await readBody(req)).toEqual({ appId: 'app', clientSecret: SECRET });
        json(res, { access_token: `token-${++tokens}`, expires_in: '7200' });
      } else if (req.headers.authorization === 'QQBot token-1') json(res, { code: 11244 }, 401);
      else if (req.headers.authorization === 'QQBot token-2') json(res, { id: req.url });
      else json(res, { code: 'bad_auth' }, 403);
    });
    close.push(() => server.close());
    const client = new QQOfficialClient({ appId: 'app', secret: SECRET, timeoutMs: 1000, apiUrl: server.url, tokenUrl: `${server.url}/token` });
    const results = await Promise.all(['/one', '/two', '/three'].map((path) => client.request('GET', path)));
    expect(results).toEqual([{ id: '/one' }, { id: '/two' }, { id: '/three' }]);
    expect(tokens).toBe(2);
  });

  it('does not retry side effects after a server error and omits response secrets from the error', async () => {
    let sends = 0;
    const server = await httpServer((req, res) => {
      if (req.url === '/token') json(res, { access_token: 'token', expires_in: 7200 });
      else { sends++; json(res, { code: 50001, message: SECRET }, 500); }
    });
    close.push(() => server.close());
    const client = new QQOfficialClient({ appId: 'app', secret: SECRET, timeoutMs: 1000, apiUrl: server.url, tokenUrl: `${server.url}/token` });
    await expect(client.request('POST', '/messages', { content: 'hello' })).rejects.toThrow('code=50001');
    expect(sends).toBe(1);
  });

  it('cancellation during token acquisition prevents the send', async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let sends = 0;
    const server = await httpServer(async (req, res) => {
      if (req.url === '/token') { entered(); await gate; json(res, { access_token: 'token', expires_in: 7200 }); }
      else { sends++; json(res, { id: 'unexpected' }); }
    });
    close.push(() => server.close());
    const client = new QQOfficialClient({ appId: 'app', secret: SECRET, timeoutMs: 1000, apiUrl: server.url, tokenUrl: `${server.url}/token` });
    const abort = new AbortController();
    const request = client.request('POST', '/messages', { content: 'cancelled' }, abort.signal);
    const rejected = expect(request).rejects.toThrow();
    await waiting; abort.abort(); release(); await rejected;
    expect(sends).toBe(0);
  });
});
