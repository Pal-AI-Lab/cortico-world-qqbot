import { object, string, type JsonObject } from './protocol.ts';

export const QQOFFICIAL_API_URL = 'https://api.bot.qq.com';
export const QQOFFICIAL_SANDBOX_URL = 'https://sandbox.api.sgroup.qq.com';

export interface QQOfficialClientOptions {
  appId: string;
  secret: string;
  timeoutMs: number;
  apiUrl?: string;
  tokenUrl?: string;
  signal?: AbortSignal;
}

export class QQOfficialApiError extends Error {
  readonly kind: 'anchor' | 'markdown' | 'newline' | 'rate' | 'proactive' | 'refused' | 'wakeup' | 'upload' | 'other';
  constructor(readonly status: number, readonly code: unknown, readonly traceId: string | null, readonly retryAfter: string | null, detail = '') {
    super(`QQ bot API HTTP ${status}; code=${typeof code === 'number' || typeof code === 'string' ? code : 'unknown'}; trace=${traceId ?? 'none'}; retry-after=${retryAfter ?? 'none'}`);
    // Interpret known rejection reasons without exposing platform response text (which may contain credentials).
    const n = Number(code);
    this.kind = [304103, 40034005, 40034026, 40034027, 40034128].includes(n) ? 'anchor'
      : n === 40034127 || /不允许发送原生\s*markdown/i.test(detail) ? 'markdown'
      : /流式消息md分片需要.*结束/.test(detail) ? 'newline'
      : status === 429 || [22009, 50002, 40034100].includes(n) ? 'rate'
      : n === 40034105 ? 'proactive' : n === 40054013 ? 'refused' : [40034122, 40034123].includes(n) ? 'wakeup'
      : n === 40093001 ? 'upload' : 'other';
  }

  get rejected(): boolean { return this.code !== 'invalid_json' && ((this.status >= 400 && this.status < 500 && this.status !== 408) || (this.status >= 200 && this.status < 300)); }
}

/** Credentials stay in the transport. POSTs are retried only after an explicit authentication rejection. */
export class QQOfficialClient {
  private token: { value: string; expiresAtMs: number } | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(private readonly options: QQOfficialClientOptions) {}

  private signal(signal?: AbortSignal): AbortSignal {
    return AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs), ...[this.options.signal, signal].filter((s): s is AbortSignal => !!s)]);
  }

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAtMs) return this.token.value;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const response = await fetch(this.options.tokenUrl ?? `${QQOFFICIAL_API_URL}/app/getAppAccessToken`, {
        method: 'POST', redirect: 'error', signal: this.signal(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: this.options.appId, clientSecret: this.options.secret }),
      });
      const data = await this.read(response);
      const value = string(data.access_token, 'access_token');
      const seconds = Number(data.expires_in);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid token expiry');
      this.token = { value, expiresAtMs: Date.now() + Math.max(0, seconds - Math.min(60, seconds / 2)) * 1000 };
      return value;
    })();
    try { return await this.refreshing; } finally { this.refreshing = null; }
  }

  async request(method: 'GET' | 'POST' | 'DELETE' | 'PUT', path: string, body?: JsonObject | FormData, signal?: AbortSignal): Promise<JsonObject> {
    for (let attempt = 0; attempt < 2; attempt++) {
      signal?.throwIfAborted();
      const token = await this.accessToken();
      const combined = this.signal(signal);
      combined.throwIfAborted();
      const response = await fetch(`${this.options.apiUrl ?? QQOFFICIAL_API_URL}${path}`, {
        method, redirect: 'error', signal: combined,
        headers: { Authorization: `QQBot ${token}`, 'X-Union-Appid': this.options.appId, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
        ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
      });
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        if (this.token?.value === token) this.token = null;
        continue;
      }
      return this.read(response);
    }
    throw new Error('Authentication failed');
  }

  private async read(response: Response): Promise<JsonObject> {
    const raw = await response.text();
    let data: JsonObject;
    try { data = raw ? object(JSON.parse(raw)) : {}; } catch {
      throw new QQOfficialApiError(response.status, 'invalid_json', response.headers.get('x-tps-trace-id'), null);
    }
    if (!response.ok || (data.code !== undefined && data.code !== 0 && data.code !== '0')) {
      throw new QQOfficialApiError(response.status, data.code, response.headers.get('x-tps-trace-id'), response.headers.get('retry-after'), typeof data.message === 'string' ? data.message : '');
    }
    return data;
  }
}
