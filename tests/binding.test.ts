import { afterEach, describe, expect, it } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { QQOfficialBinding } from '../src/binding.ts';
import { QQOfficialWorld } from '../src/world.ts';
import { QQOFFICIAL_SECRET } from '../src/config.ts';
import { context, httpServer, json, readBody, SECRET } from './helpers.ts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((fn) => fn())); });

function encrypt(secret: string, key: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  return Buffer.concat([nonce, cipher.update(secret), cipher.final(), cipher.getAuthTag()]).toString('base64');
}

describe('official QQ bot credential binding', () => {
  it('keeps the binding key server-side and persists decrypted credentials without returning the secret', async () => {
    let key: Buffer;
    let ready = false;
    const server = await httpServer(async (req, res) => {
      const body = await readBody(req);
      if (req.url === '/lite/create_bind_task') { key = Buffer.from(body.key as string, 'base64'); json(res, { retcode: 0, data: { task_id: 'task/id' } }); }
      else if (!ready) json(res, { retcode: 0, data: { status: 1 } });
      else { expect(body.task_id).toBe('task/id'); json(res, { data: { status: 2, bot_appid: 123456, bot_encrypt_secret: encrypt(SECRET, key) } }); }
    });
    cleanup.push(() => server.close());
    const ctx = context();
    const world = new QQOfficialWorld({ context: ctx.value, endpoints: { bindingUrl: server.url } });
    const invoke = world.webUi('en').invoke!;
    const link = await invoke('connection', 'bind', []) as { url: string };
    expect(link).toEqual({ url: `${server.url}/qqbot/openclaw/connect.html?task_id=task%2Fid&_wv=2` });
    expect(await invoke('connection', 'poll', [])).toMatchObject({ kind: 'pending' });
    ready = true;
    const result = await invoke('connection', 'poll', []);
    expect(result).toMatchObject({ kind: 'bound' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(ctx.value.cfg.appId).toBe('123456');
    expect(ctx.value.secret(QQOFFICIAL_SECRET)).toBe(SECRET);
    expect(JSON.stringify(await invoke('connection', 'state', []))).not.toContain(SECRET);
    expect(ctx.value.cfg.enabled).toBe(false);
  });

  it('rejects tampered credential ciphertext and forgets an expired task', async () => {
    let expired = false;
    const server = await httpServer((req, res) => {
      if (req.url === '/lite/create_bind_task') json(res, { data: { task_id: 'task' } });
      else json(res, { data: expired ? { status: 3 } : { status: 2, bot_appid: 'app', bot_encrypt_secret: encrypt(SECRET, randomBytes(32)) } });
    });
    cleanup.push(() => server.close());
    const binding = new QQOfficialBinding(1000, server.url);
    await binding.start();
    await expect(binding.poll()).rejects.toThrow();
    expired = true;
    expect(await binding.poll()).toEqual({ kind: 'expired' });
    expect(await binding.poll()).toEqual({ kind: 'expired' });
  });

  it('requires a new secret when changing accounts and rejects newline injection', async () => {
    const ctx = context({ appId: 'original' }); ctx.secrets.set(QQOFFICIAL_SECRET, SECRET);
    const invoke = new QQOfficialWorld({ context: ctx.value }).webUi().invoke!;
    await expect(invoke('connection', 'save', [{ appId: 'new', secret: '' }])).rejects.toThrow();
    await expect(invoke('connection', 'save', [{ appId: 'original', secret: 'value\nOTHER=value' }])).rejects.toThrow();
    expect(ctx.value.cfg.appId).toBe('original');
    expect(ctx.value.secret(QQOFFICIAL_SECRET)).toBe(SECRET);
  });
});
