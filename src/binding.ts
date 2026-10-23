import { createDecipheriv, randomBytes } from 'node:crypto';
import { object, string } from './protocol.ts';

export type QQOfficialBindingResult = { kind: 'pending' | 'expired' } | { kind: 'bound'; appId: string; secret: string };

/** The binding key stays on the server; only the connection URL goes to the console. */
export class QQOfficialBinding {
  private task: { id: string; key: Buffer; createdAtMs: number } | null = null;
  constructor(private readonly timeoutMs: number, private readonly baseUrl = 'https://q.qq.com') {}

  private async request(path: string, payload: unknown) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Binding HTTP ${response.status}`);
    const result = object(await response.json());
    if (result.retcode !== undefined && Number(result.retcode) !== 0) throw new Error(`Binding retcode=${String(result.retcode)}`);
    return object(result.data);
  }

  async start(): Promise<{ url: string }> {
    const key = randomBytes(32);
    const data = await this.request('/lite/create_bind_task', { key: key.toString('base64') });
    const id = string(data.task_id, 'task_id');
    this.task = { id, key, createdAtMs: Date.now() };
    return { url: `${this.baseUrl}/qqbot/openclaw/connect.html?task_id=${encodeURIComponent(id)}&_wv=2` };
  }

  async poll(): Promise<QQOfficialBindingResult> {
    const task = this.task;
    if (!task || Date.now() - task.createdAtMs > 10 * 60 * 1000) { this.task = null; return { kind: 'expired' }; }
    const data = await this.request('/lite/poll_bind_result', { task_id: task.id });
    if (this.task !== task) return { kind: 'expired' };
    const status = Number(data.status);
    if (status === 3) { this.task = null; return { kind: 'expired' }; }
    if (status !== 2) return { kind: 'pending' };
    const appId = string(typeof data.bot_appid === 'number' && Number.isSafeInteger(data.bot_appid) ? String(data.bot_appid) : data.bot_appid, 'bot_appid');
    const encrypted = Buffer.from(string(data.bot_encrypt_secret, 'bot_encrypt_secret'), 'base64');
    if (encrypted.length <= 28) throw new Error('Invalid binding ciphertext');
    const cipher = createDecipheriv('aes-256-gcm', task.key, encrypted.subarray(0, 12));
    cipher.setAuthTag(encrypted.subarray(-16));
    const secret = Buffer.concat([cipher.update(encrypted.subarray(12, -16)), cipher.final()]).toString('utf8');
    return { kind: 'bound', appId, secret: string(secret, 'AppSecret') };
  }

  clear(): void { this.task = null; }
}
