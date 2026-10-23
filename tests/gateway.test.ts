import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { QQOfficialClient } from '../src/client.ts';
import { QQOfficialGateway } from '../src/gateway.ts';
import { QQOFFICIAL_DEFAULTS } from '../src/config.ts';
import { httpServer, json, SECRET } from './helpers.ts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function setup(onConnection: (ws: WebSocket, connection: number) => void, onEvent: ConstructorParameters<typeof QQOfficialGateway>[0]['onEvent']) {
  let url = '';
  const server = await httpServer((req, res) => {
    if (req.url === '/token') json(res, { access_token: 'token', expires_in: 7200 });
    else json(res, { url: url.replace('http:', 'ws:') });
  });
  url = server.url;
  cleanup.push(() => server.close());
  const wss = new WebSocketServer({ server: server.server });
  let connections = 0;
  wss.on('connection', (ws) => onConnection(ws, ++connections));
  cleanup.push(async () => { for (const ws of wss.clients) ws.terminate(); await new Promise<void>((resolve) => wss.close(() => resolve())); });
  const states: string[] = [];
  const gateway = new QQOfficialGateway({
    client: new QQOfficialClient({ appId: 'app', secret: SECRET, timeoutMs: 1000, apiUrl: url, tokenUrl: `${url}/token` }),
    intents: QQOFFICIAL_DEFAULTS.intents, timeoutMs: 1000, reconnectMs: 10, maxReconnectMs: 30,
    onEvent, onState: (state) => states.push(state),
  });
  cleanup.push(() => gateway.stop());
  gateway.start();
  return { gateway, states, connections: () => connections };
}

describe('gateway lifecycle', () => {
  it('resumes from the last persisted sequence and stops reconnecting after stop', async () => {
    const handshakes: Record<string, unknown>[] = [];
    const delivered: string[] = [];
    const endpoint = await setup((ws, connection) => {
      ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 25 } }));
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.op === 1) { ws.send(JSON.stringify({ op: 11 })); if (connection === 1 && frame.d === 2) ws.terminate(); return; }
        handshakes.push(frame);
        if (frame.op === 2) {
          ws.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { session_id: 'session' } }));
          ws.send(JSON.stringify({ op: 0, t: 'C2C_MESSAGE_CREATE', s: 2, d: { id: 'first' } }));
        } else if (frame.op === 6) {
          ws.send(JSON.stringify({ op: 0, t: 'RESUMED', s: 3, d: '' }));
          ws.send(JSON.stringify({ op: 0, t: 'C2C_MESSAGE_CREATE', s: 4, d: { id: 'second' } }));
        }
      });
    }, async (event) => { delivered.push(String(event.d.id)); });
    await expect.poll(() => delivered).toEqual(['first', 'second']);
    expect(handshakes[0]).toMatchObject({ op: 2, d: { intents: QQOFFICIAL_DEFAULTS.intents, shard: [0, 1] } });
    expect(handshakes[1]).toMatchObject({ op: 6, d: { session_id: 'session', seq: 2 } });
    await endpoint.gateway.stop();
    expect(endpoint.connections()).toBe(2);
    expect(endpoint.states.at(-1)).toBe('offline');
  });

  it('does not acknowledge a sequence until event persistence completes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heartbeats: number[] = [];
    await setup((ws) => {
      ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 15 } }));
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.op === 2) {
          ws.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { session_id: 'session' } }));
          ws.send(JSON.stringify({ op: 0, t: 'MESSAGE_CREATE', s: 2, d: { id: 'message' } }));
        } else if (frame.op === 1) { heartbeats.push(frame.d); ws.send(JSON.stringify({ op: 11 })); }
      });
    }, async () => { await gate; });
    try { await expect.poll(() => heartbeats.length).toBeGreaterThan(1); expect(heartbeats.every((s) => s === 1)).toBe(true); }
    finally { release(); }
    await expect.poll(() => heartbeats.includes(2)).toBe(true);
  });

  it('stops after a forbidden intent close instead of exhausting identify quota', async () => {
    const endpoint = await setup((ws) => { ws.close(4014, 'forbidden intents'); }, async () => {});
    await expect.poll(() => endpoint.states.at(-1)).toBe('error');
    await endpoint.gateway.stop();
    expect(endpoint.connections()).toBe(1);
  });

  it('reconnects when heartbeat acknowledgements stop', async () => {
    const endpoint = await setup((ws) => {
      ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 15 } }));
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.op === 2) ws.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { session_id: 'session' } }));
        if (frame.op === 6) ws.send(JSON.stringify({ op: 0, t: 'RESUMED', s: 1, d: '' }));
      });
    }, async () => {});
    await expect.poll(() => endpoint.connections()).toBeGreaterThanOrEqual(2);
  });
});
