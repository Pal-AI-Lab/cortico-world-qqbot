import WebSocket from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { QQOfficialClient } from './client.ts';
import { dispatch, object, string, type QQOfficialDispatch } from './protocol.ts';

export type QQOfficialConnectionState = 'offline' | 'connecting' | 'online' | 'error';
export interface QQOfficialGatewayOptions {
  client: QQOfficialClient;
  intents: number;
  reconnectMs: number;
  maxReconnectMs: number;
  timeoutMs: number;
  onEvent(event: QQOfficialDispatch): Promise<void>;
  onState(state: QQOfficialConnectionState, detail?: string): void;
}

class FatalGatewayError extends Error {}

/** Resume advances only after event persistence. Heartbeats run independently of event delivery. */
export class QQOfficialGateway {
  private abort = new AbortController();
  private task: Promise<void> | null = null;
  private session: string | null = null;
  private sequence: number | null = null;

  constructor(private readonly options: QQOfficialGatewayOptions) {}

  start(): void { this.task ??= this.run(); }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.task;
    this.options.onState('offline');
  }

  private async run(): Promise<void> {
    let backoff = this.options.reconnectMs;
    while (!this.abort.signal.aborted) {
      this.options.onState('connecting');
      try {
        const gateway = await this.options.client.request('GET', '/gateway', undefined, this.abort.signal);
        const token = await this.options.client.accessToken();
        this.abort.signal.throwIfAborted();
        await this.connect(string(gateway.url, 'gateway.url'), token, () => { backoff = this.options.reconnectMs; });
      } catch (error) {
        if (this.abort.signal.aborted) break;
        this.options.onState('error', error instanceof Error ? error.message : String(error));
        if (error instanceof FatalGatewayError) break;
      }
      try { await delay(backoff, undefined, { signal: this.abort.signal }); } catch { break; }
      backoff = Math.min(backoff * 2, this.options.maxReconnectMs);
    }
  }

  private connect(url: string, token: string, ready: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { handshakeTimeout: this.options.timeoutMs, maxPayload: 1024 * 1024 });
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let acknowledged = true;
      let failure: Error | undefined;
      let queue = Promise.resolve();
      const handshake = setTimeout(() => fail(new Error('Gateway ready timeout')), this.options.timeoutMs);
      const send = (data: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
      const fail = (error: Error) => { failure ??= error; ws.terminate(); };
      const abort = () => ws.terminate();
      this.abort.signal.addEventListener('abort', abort, { once: true });
      ws.on('error', (error) => { failure ??= new Error(`Gateway transport: ${error.message}`); });
      ws.on('message', (raw) => {
        try {
          const frame = object(JSON.parse(raw.toString()));
          if (frame.op === 10) {
            const interval = object(frame.d).heartbeat_interval;
            if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) throw new Error('Invalid heartbeat interval');
            if (heartbeat) clearInterval(heartbeat);
            heartbeat = setInterval(() => {
              if (!acknowledged) { fail(new Error('Gateway heartbeat timeout')); return; }
              acknowledged = false;
              send({ op: 1, d: this.sequence });
            }, interval);
            send(this.session ? { op: 6, d: { token: `QQBot ${token}`, session_id: this.session, seq: this.sequence } }
              : { op: 2, d: { token: `QQBot ${token}`, intents: this.options.intents, shard: [0, 1] } });
          } else if (frame.op === 11) acknowledged = true;
          else if (frame.op === 1) send({ op: 1, d: this.sequence });
          else if (frame.op === 7) ws.terminate();
          else if (frame.op === 9) {
            if (frame.d !== true) { this.session = null; this.sequence = null; }
            fail(new Error('Gateway session rejected'));
          } else if (frame.op === 0) {
            queue = queue.then(async () => {
              if (failure || this.abort.signal.aborted) return;
              if (frame.t === 'READY') {
                this.session = string(object(frame.d).session_id, 'session_id');
                ready(); clearTimeout(handshake); this.options.onState('online');
              } else if (frame.t === 'RESUMED') {
                ready(); clearTimeout(handshake); this.options.onState('online');
              } else await this.options.onEvent(dispatch(frame));
              if (Number.isSafeInteger(frame.s)) this.sequence = frame.s as number;
            }).catch((error: unknown) => fail(error instanceof Error ? error : new Error(String(error))));
          }
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      });
      ws.once('close', (code) => {
        clearTimeout(handshake);
        if (heartbeat) clearInterval(heartbeat);
        this.abort.signal.removeEventListener('abort', abort);
        void queue.then(() => {
          if ([4006, 4007].includes(code) || (code >= 4900 && code <= 4913)) {
            this.session = null; this.sequence = null;
          }
          if ([4001, 4002, 4010, 4011, 4012, 4013, 4014, 4914, 4915].includes(code)) failure = new FatalGatewayError(`Gateway closed: ${code}`);
          if (this.abort.signal.aborted) resolve();
          else reject(failure ?? new Error(`Gateway closed: ${code}`));
        });
      });
      if (this.abort.signal.aborted) abort();
    });
  }
}
