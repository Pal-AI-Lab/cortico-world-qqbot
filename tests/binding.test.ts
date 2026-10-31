import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { QQOfficialBinding } from '../src/binding.ts';
import { QQOfficialWorld } from '../src/world.ts';
import { QQOFFICIAL_SECRET } from '../src/config.ts';
import { qqOfficialText } from '../src/strings.ts';
import { LocalizedError } from 'cortico/core/language.ts';
import { context, httpServer, json, readBody, SECRET, TestHost } from './helpers.ts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(cleanup.splice(0).map((fn) => fn())); });

function encrypt(secret: string, key: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  return Buffer.concat([nonce, cipher.update(secret), cipher.final(), cipher.getAuthTag()]).toString('base64');
}

describe('official QQ bot credential binding', () => {
  it('keeps the binding key server-side and persists decrypted credentials without returning the secret', async () => {
    let key: Buffer;
    let ready = false;
    let tokenCode = 0;
    const server = await httpServer(async (req, res) => {
      const body = await readBody(req);
      if (req.url === '/token') { json(res, tokenCode ? { code: tokenCode, message: 'invalid appid or secret' } : { access_token: 'token', expires_in: 7200 }); return; }
      if (req.url === '/lite/create_bind_task') { key = Buffer.from(body.key as string, 'base64'); json(res, { retcode: 0, data: { task_id: 'task/id' } }); }
      else if (!ready) json(res, { retcode: 0, data: { status: 1 } });
      else { expect(body.task_id).toBe('task/id'); json(res, { data: { status: 2, bot_appid: 123456, bot_encrypt_secret: encrypt(SECRET, key) } }); }
    });
    cleanup.push(() => server.close());
    const ctx = context();
    ctx.value.restart = vi.fn(async () => {});
    const world = new QQOfficialWorld({ context: ctx.value, endpoints: { bindingUrl: server.url, tokenUrl: `${server.url}/token` } });
    const invoke = world.webUi('en').invoke!;
    // A scan whose secret yields no token asks for a new scan and saves nothing.
    tokenCode = 100016; ready = true;
    await invoke('connection', 'bind', []);
    expect(await invoke('connection', 'poll', [])).toEqual({ kind: 'invalid', message: qqOfficialText('en').invalidCredentials });
    expect(ctx.value.cfg.appId).toBe('');
    expect(ctx.value.secret(QQOFFICIAL_SECRET)).toBe('');
    tokenCode = 0; ready = false;
    const link = await invoke('connection', 'bind', []) as { url: string; qrDataUrl: string };
    expect(link).toEqual({ url: `${server.url}/qqbot/openclaw/connect.html?task_id=task%2Fid&_wv=2`, qrDataUrl: expect.stringMatching(/^data:image\/png;base64,/), expiresAtMs: expect.any(Number) });
    const qr = PNG.sync.read(Buffer.from(link.qrDataUrl.split(',')[1], 'base64'));
    expect(jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height)?.data).toBe(link.url);
    expect(await invoke('connection', 'state', [])).toMatchObject({ binding: link });
    expect(JSON.stringify(link)).not.toContain(key!.toString('base64'));
    expect(await invoke('connection', 'poll', [])).toMatchObject({ kind: 'pending' });
    ready = true;
    const result = await invoke('connection', 'poll', []);
    expect(result).toMatchObject({ kind: 'bound' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(ctx.value.cfg.appId).toBe('123456');
    expect(ctx.value.secret(QQOFFICIAL_SECRET)).toBe(SECRET);
    const saved = await invoke('connection', 'state', []);
    expect(saved).toMatchObject({ appId: '123456', secretSet: true, binding: null });
    expect(JSON.stringify(saved)).not.toContain(SECRET);
    expect(ctx.value.cfg.enabled).toBe(true);
    expect(ctx.value.restart).toHaveBeenCalledOnce();
  });

  it('expires the resumable task without a network request after three minutes', async () => {
    let polls = 0;
    const server = await httpServer((req, res) => {
      if (req.url === '/lite/create_bind_task') json(res, { data: { task_id: 'task' } });
      else { polls++; json(res, { data: { status: 1 } }); }
    });
    cleanup.push(() => server.close());
    vi.useFakeTimers({ toFake: ['Date'] });
    const binding = new QQOfficialBinding(1000, server.url);
    const task = await binding.start();
    vi.setSystemTime(task.expiresAtMs - 1);
    expect(binding.current()).toEqual(task);
    vi.setSystemTime(task.expiresAtMs);
    expect(binding.current()).toBeNull();
    expect(await binding.poll()).toEqual({ kind: 'expired' });
    expect(polls).toBe(0);
  });

  it('cancels pending binding when credentials are saved manually', async () => {
    const server = await httpServer((_req, res) => json(res, { data: { task_id: 'task' } }));
    cleanup.push(() => server.close());
    const ctx = context();
    const invoke = new QQOfficialWorld({ context: ctx.value, endpoints: { bindingUrl: server.url } }).webUi().invoke!;
    await invoke('connection', 'bind', []);
    await invoke('configuration', 'save', [{ values: { 'worlds.qq-official.appId': 'manual' }, secret: SECRET }]);
    expect(await invoke('connection', 'state', [])).toMatchObject({ appId: 'manual', secretSet: true, binding: null });
    expect(await invoke('connection', 'poll', [])).toMatchObject({ kind: 'expired' });
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
    await expect(invoke('configuration', 'save', [{ values: { 'worlds.qq-official.appId': 'new' }, secret: '' }])).rejects.toThrow();
    await expect(invoke('configuration', 'save', [{ values: { 'worlds.qq-official.appId': 'original' }, secret: 'value\nOTHER=value' }])).rejects.toThrow();
    expect(ctx.value.cfg.appId).toBe('original');
    expect(ctx.value.secret(QQOFFICIAL_SECRET)).toBe(SECRET);
  });

  it('validates all configuration before changing credentials and applies a valid update', async () => {
    const ctx = context({ appId: 'original', enabled: true }); ctx.secrets.set(QQOFFICIAL_SECRET, SECRET);
    ctx.value.restart = vi.fn(async () => {});
    const invoke = new QQOfficialWorld({ context: ctx.value }).webUi('en').invoke!;
    await expect(invoke('configuration', 'save', [{ values: { 'worlds.qq-official.appId': 'new', 'worlds.qq-official.timeoutMs': 0 }, secret: 'new-secret' }])).rejects.toThrow();
    expect(ctx.value.cfg.appId).toBe('original');
    expect(ctx.value.secret(QQOFFICIAL_SECRET)).toBe(SECRET);
    await invoke('configuration', 'save', [{ values: { 'worlds.qq-official.appId': 'new', 'worlds.qq-official.timeoutMs': 5000 }, secret: 'new-secret' }]);
    expect(ctx.value.cfg).toMatchObject({ appId: 'new', timeoutMs: 5000, enabled: true });
    expect(ctx.value.secret(QQOFFICIAL_SECRET)).toBe('new-secret');
    expect(ctx.value.restart).toHaveBeenCalledOnce();
    const result = await invoke('configuration', 'state', []);
    expect(result).toMatchObject({ secretSet: true, values: { 'worlds.qq-official.appId': 'new', 'worlds.qq-official.timeoutMs': 5000 } });
    expect(JSON.stringify(result)).not.toContain('new-secret');
    expect(JSON.stringify(ctx.value.cfg)).not.toContain('new-secret');
    await invoke('configuration', 'save', [{ values: { 'worlds.qq-official.timeoutMs': 6000 }, secret: '' }]);
    expect(ctx.value.secret(QQOFFICIAL_SECRET)).toBe('new-secret');
  });

  it('cancels a QR task without removing existing credentials or disconnecting', async () => {
    const server = await httpServer((_req, res) => json(res, { data: { task_id: 'task' } }));
    cleanup.push(() => server.close());
    const ctx = context({ appId: 'original', enabled: true }); ctx.secrets.set(QQOFFICIAL_SECRET, SECRET);
    ctx.value.restart = vi.fn(async () => {});
    const invoke = new QQOfficialWorld({ context: ctx.value, endpoints: { bindingUrl: server.url } }).webUi().invoke!;
    await invoke('connection', 'bind', []);
    await invoke('connection', 'cancel', []);
    expect(await invoke('connection', 'state', [])).toMatchObject({ appId: 'original', secretSet: true, enabled: true, binding: null });
    expect(ctx.value.restart).not.toHaveBeenCalled();
  });

  it('preserves saved credentials when starting the message connection fails', async () => {
    const ctx = context({ appId: 'original' }); ctx.secrets.set(QQOFFICIAL_SECRET, SECRET);
    ctx.value.restart = vi.fn(async () => { throw new Error('Connection unavailable'); });
    const invoke = new QQOfficialWorld({ context: ctx.value }).webUi().invoke!;
    expect(await invoke('connection', 'connect', [])).toEqual({ connectionError: 'Connection unavailable' });
    expect(ctx.value.secret(QQOFFICIAL_SECRET)).toBe(SECRET);
  });
});

describe('starting without a bound bot', () => {
  it('says where to bind instead of throwing a bare field error', async () => {
    const ctx = context({ appId: '' });
    const world = new QQOfficialWorld({ context: ctx.value });
    const error = await world.start(new TestHost()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LocalizedError);
    expect((error as LocalizedError).describe('zh')).toBe(qqOfficialText('zh').notBound);
  });
});
