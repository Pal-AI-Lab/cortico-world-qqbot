import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dispatch, object, string, type QQOfficialDispatch } from './protocol.ts';

export function signingKey(secret: string) {
  if (!secret) throw new Error('Empty AppSecret');
  const bytes = Buffer.from(secret);
  const seed = Buffer.alloc(32);
  for (let i = 0; i < seed.length; i++) seed[i] = bytes[i % bytes.length];
  return createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
}

export interface QQOfficialWebhookOptions {
  secret: string;
  host: string;
  port: number;
  path: string;
  maxBodyBytes: number;
  onEvent(event: QQOfficialDispatch): Promise<void>;
  onError(error: unknown): void;
}

/** A successful acknowledgement follows persistence; failed delivery remains retryable. */
export class QQOfficialWebhook {
  private server: Server | null = null;
  private active = new Set<Promise<void>>();
  constructor(private readonly options: QQOfficialWebhookOptions) {}

  async start(): Promise<number> {
    const key = signingKey(this.options.secret);
    const publicKey = createPublicKey(key);
    const server = createServer({ requestTimeout: 10000, headersTimeout: 10000 }, (req, res) => {
      const task = this.handle(req, res, key, publicKey).catch((error: unknown) => {
        this.options.onError(error);
        if (!res.headersSent) this.reply(res, 503, { error: 'delivery_failed' });
        else res.destroy();
      });
      this.active.add(task);
      void task.finally(() => this.active.delete(task));
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port, this.options.host, () => { server.off('error', reject); resolve(); });
    });
    server.on('error', this.options.onError);
    return (server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
    await Promise.allSettled(this.active);
  }

  private reply(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private async handle(req: IncomingMessage, res: ServerResponse, key: ReturnType<typeof signingKey>, publicKey: ReturnType<typeof createPublicKey>): Promise<void> {
    if (req.url?.split('?')[0] !== this.options.path) { this.reply(res, 404, {}); return; }
    if (req.method !== 'POST') { this.reply(res, 405, {}); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > this.options.maxBodyBytes) { this.reply(res, 413, { error: 'body_too_large' }); return; }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    let payload;
    try { payload = object(JSON.parse(body.toString('utf8'))); } catch { this.reply(res, 400, { error: 'invalid_json' }); return; }
    if (payload.op === 13) {
      try {
        const d = object(payload.d);
        const plainToken = string(d.plain_token, 'plain_token');
        const timestamp = string(d.event_ts, 'event_ts');
        this.reply(res, 200, { plain_token: plainToken, signature: sign(null, Buffer.from(timestamp + plainToken), key).toString('hex') });
      } catch { this.reply(res, 400, { error: 'invalid_challenge' }); }
      return;
    }
    const timestamp = req.headers['x-signature-timestamp'];
    const signature = req.headers['x-signature-ed25519'];
    if (typeof timestamp !== 'string' || typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)
      || !verify(null, Buffer.concat([Buffer.from(timestamp), body]), publicKey, Buffer.from(signature, 'hex'))) {
      this.reply(res, 401, { error: 'invalid_signature' }); return;
    }
    if (payload.op === 0) {
      let event;
      try { event = dispatch(payload); } catch { this.reply(res, 400, { error: 'invalid_dispatch' }); return; }
      await this.options.onEvent(event);
    }
    this.reply(res, 200, { opcode: 12 });
  }
}
