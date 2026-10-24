import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createCipheriv, randomBytes } from 'node:crypto';
import * as sdkUi from 'cortico/web/client/ui/index.ts';
import type { WebUiPanelContext, WebUiMemo } from 'cortico/web/shared/client-panel.ts';
import bundle from '../src/webui.js';
import { QQOfficialWorld } from '../src/world.ts';
import { QQOFFICIAL_SECRET } from '../src/config.ts';
import { qqOfficialText } from '../src/strings.ts';
import { context, httpServer, json, readBody, SECRET } from './helpers.ts';

let dom: JSDOM;
const cleanup: Array<() => void | Promise<void>> = [];
beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>');
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('AbortController', dom.window.AbortController);
});
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.useRealTimers(); dom.window.close(); vi.unstubAllGlobals();
});
function panel(invoke: WebUiPanelContext['invoke']) {
  const abort = new AbortController();
  cleanup.push(() => abort.abort());
  const root = document.createElement('div'); document.body.append(root);
  const memo: WebUiMemo = { get: (_key, fallback) => fallback, set: () => {} };
  // Exercise the same panel against the API 6 SDK and Coopanion's API 5 SDK.
  const factories = sdkUi as { createWebUi?: typeof sdkUi.createWebUi; createConsoleUi?: typeof sdkUi.createWebUi };
  const ui = (factories.createWebUi ?? factories.createConsoleUi)!({ memo, overlayHost: document.body, signal: abort.signal });
  const refresh = vi.fn(async () => {});
  return { abort, root, refresh, ctx: { root, invoke, signal: abort.signal, ui, refresh } as unknown as WebUiPanelContext };
}
function click(root: HTMLElement, label: string) {
  const button = [...root.querySelectorAll('button')].find((button) => button.textContent === label);
  expect(button, label).toBeDefined(); button!.click();
}
const text = qqOfficialText('en');
const pendingTask = () => ({ url: 'https://q.qq.com/qqbot/openclaw/connect.html?task_id=test', qrDataUrl: 'data:image/png;base64,dGVzdA==', expiresAtMs: Date.now() + 600000 });
const waitingState = (binding: ReturnType<typeof pendingTask> | null = pendingTask()) => ({ appId: '', secretSet: false, enabled: false, status: 'offline' as string, detail: '', binding, text });
const readyState = (status = 'online') => ({ ...waitingState(null), appId: '123456', secretSet: true, enabled: true, status });

it.each(['new', 'resumed'])('automatically completes a %s QR binding and moves credentials to configuration', async (mode) => {
  let key: Buffer;
  let creates = 0;
  let polls = 0;
  const server = await httpServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === '/lite/create_bind_task') {
      creates++; key = Buffer.from(body.key as string, 'base64'); json(res, { data: { task_id: 'task' } });
    } else if (++polls === 1) json(res, { data: { status: 1 } });
    else {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const encrypted = Buffer.concat([nonce, cipher.update(SECRET), cipher.final(), cipher.getAuthTag()]).toString('base64');
      json(res, { data: { status: 2, bot_appid: 123456, bot_encrypt_secret: encrypted } });
    }
  });
  cleanup.push(() => server.close());
  const state = context();
  state.value.restart = vi.fn(async () => {});
  const world = new QQOfficialWorld({ context: state.value, endpoints: { bindingUrl: server.url } });
  const declaration = world.webUi('en');
  expect(declaration.panels?.map((p) => p.title)).toEqual([text.connectionTab, text.configTab]);
  const invoke = declaration.invoke!;
  if (mode === 'resumed') await invoke('connection', 'bind', []);
  const p = panel((method, args = []) => invoke('connection', method, args) as never);
  await bundle.panels.connection.mount(p.ctx);
  expect(p.root.querySelector('input')).toBeNull();
  if (mode === 'new') click(p.root, text.scanTitle);
  await vi.waitFor(() => expect(p.root.querySelector('img')?.src).toMatch(/^data:image\/png;base64,/));
  expect(p.root.querySelector('img')?.alt).toBe(text.qrAlt);
  await vi.waitFor(() => expect(p.root.textContent).toContain(text.authorized), { timeout: 6000 });
  expect(state.value.secret(QQOFFICIAL_SECRET)).toBe(SECRET);
  expect(state.value.cfg).toMatchObject({ appId: '123456', enabled: true });
  expect(state.value.restart).toHaveBeenCalledOnce();
  expect(p.root.querySelector('img')).toBeNull();
  expect(p.root.querySelector('.qq-binding-link')).toBeNull();
  expect(p.root.textContent).not.toContain(text.success);
  expect(p.root.textContent).not.toContain('123456');
  expect(p.root.innerHTML).not.toContain(SECRET);
  expect(p.refresh).toHaveBeenCalled();
  expect(polls).toBe(2); expect(creates).toBe(1);
  const config = panel((method, args = []) => invoke('configuration', method, args) as never);
  await bundle.panels.configuration.mount(config.ctx);
  expect(config.root.querySelector('input')?.value).toBe('123456');
  expect(config.root.querySelector<HTMLInputElement>('input[type=password]')?.placeholder).toBe(text.secretSet);
});

it('removes the QR after authorization and shows success only when the message channel is online', async () => {
  vi.useFakeTimers();
  let state = waitingState();
  const p = panel((method) => {
    if (method === 'poll') { state = readyState('connecting'); return Promise.resolve({ kind: 'bound', appId: state.appId }) as never; }
    return Promise.resolve(state) as never;
  });
  await bundle.panels.connection.mount(p.ctx);
  expect(p.root.querySelector('img')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(2000);
  expect(p.root.querySelector('img')).toBeNull();
  expect(p.root.textContent).toContain(text.authorized);
  expect(p.root.textContent).not.toContain(text.success);
  state = readyState();
  await vi.advanceTimersByTimeAsync(2000);
  expect(p.root.querySelector('h2')?.textContent).toBe(text.success);
  expect(p.root.querySelector('img')).toBeNull();
  state = { ...readyState('error'), detail: 'Gateway unavailable' };
  await vi.advanceTimersByTimeAsync(5000);
  expect(p.root.textContent).not.toContain(text.success);
  expect(p.root.textContent).toContain('Gateway unavailable');
});

it('opens an already connected bot with success and no QR or credential inputs', async () => {
  const p = panel(() => Promise.resolve(readyState()) as never);
  await bundle.panels.connection.mount(p.ctx);
  expect(p.root.querySelector('h2')?.textContent).toBe(text.success);
  expect(p.root.querySelector('img, input')).toBeNull();
  expect(p.root.querySelector('a')?.href).toContain('/configuration');
});

it('waits for each poll and retries a transient failure', async () => {
  vi.useFakeTimers();
  let state = waitingState();
  let complete!: (value: unknown) => void;
  const poll = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }))
    .mockRejectedValueOnce(new Error('Temporary failure'))
    .mockImplementationOnce(async () => { state = readyState(); return { kind: 'bound', appId: state.appId }; });
  const p = panel((method) => (method === 'state' ? Promise.resolve(state) : poll()) as never);
  await bundle.panels.connection.mount(p.ctx);
  await vi.advanceTimersByTimeAsync(10000);
  expect(poll).toHaveBeenCalledOnce();
  complete({ kind: 'pending' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(p.root.textContent).toContain('Temporary failure');
  await vi.advanceTimersByTimeAsync(2000);
  expect(p.root.querySelector('h2')?.textContent).toBe(text.success);
  await vi.advanceTimersByTimeAsync(10000);
  expect(poll).toHaveBeenCalledTimes(3);
});

it.each(['server', 'deadline'])('removes an expired QR and stops checking when it expires on the %s', async (mode) => {
  vi.useFakeTimers();
  const task = pendingTask();
  if (mode === 'deadline') task.expiresAtMs = Date.now() + 1000;
  let state = waitingState(task);
  const poll = vi.fn(async () => { state = waitingState(null); return { kind: 'expired' }; });
  const p = panel((method) => (method === 'state' ? Promise.resolve(state) : poll()) as never);
  await bundle.panels.connection.mount(p.ctx);
  await vi.advanceTimersByTimeAsync(10000);
  expect(p.root.textContent).toContain(text.expired);
  expect(p.root.querySelector('img')).toBeNull();
  expect(p.root.textContent).toContain(text.refreshQr);
  expect(poll).toHaveBeenCalledTimes(mode === 'server' ? 1 : 0);
});

it('cancels polling and ignores a late result after the panel unmounts', async () => {
  vi.useFakeTimers();
  let complete!: (value: unknown) => void;
  const poll = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
  const state = waitingState();
  const invoke = vi.fn((method) => method === 'state' ? Promise.resolve(state) : poll());
  const p = panel(invoke as WebUiPanelContext['invoke']);
  await bundle.panels.connection.mount(p.ctx);
  await vi.advanceTimersByTimeAsync(2000);
  p.abort.abort();
  const html = p.root.innerHTML;
  complete({ kind: 'bound', appId: '123456' });
  await vi.advanceTimersByTimeAsync(10000);
  expect(invoke.mock.calls.map(([method]) => method)).toEqual(['state', 'poll']);
  expect(p.root.innerHTML).toBe(html);
  expect(p.refresh).not.toHaveBeenCalled();
});

it('ignores a stale result after a new QR replaces it', async () => {
  vi.useFakeTimers();
  let complete!: (value: unknown) => void;
  const poll = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
  const next = { ...pendingTask(), url: 'https://q.qq.com/qqbot/openclaw/connect.html?task_id=next' };
  const state = waitingState();
  const p = panel((method) => (method === 'state' ? Promise.resolve(state)
    : method === 'bind' ? Promise.resolve(next) : poll()) as never);
  await bundle.panels.connection.mount(p.ctx);
  await vi.advanceTimersByTimeAsync(2000);
  click(p.root, text.refreshQr);
  await vi.advanceTimersByTimeAsync(0);
  complete({ kind: 'expired' });
  await vi.advanceTimersByTimeAsync(0);
  expect(p.root.querySelector<HTMLAnchorElement>('.qq-binding-link')?.href).toBe(next.url);
  expect(p.root.querySelector('img')).not.toBeNull();
  expect(p.root.textContent).not.toContain(text.expired);
  expect(p.refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000);
  expect(poll).toHaveBeenCalledTimes(2);
});

it('saves credentials and settings together from configuration without exposing the secret', async () => {
  const state = context();
  const invoke = new QQOfficialWorld({ context: state.value }).webUi('en').invoke!;
  const p = panel((method, args = []) => invoke('configuration', method, args) as never);
  await bundle.panels.configuration.mount(p.ctx);
  const inputs = p.root.querySelectorAll('input');
  inputs[0].value = 'application'; inputs[1].value = SECRET;
  click(p.root, text.saveConfig);
  await vi.waitFor(() => expect(inputs[1].value).toBe(''));
  expect(state.value.secret(QQOFFICIAL_SECRET)).toBe(SECRET);
  expect(state.value.cfg.appId).toBe('application');
  expect(inputs[1].placeholder).toBe(text.secretSet);
  expect(p.root.textContent).toContain(text.configSaved);
  expect(p.root.innerHTML).not.toContain(SECRET);
});

it('refreshes the host after a configuration-triggered connection becomes ready', async () => {
  vi.useFakeTimers();
  const ctx = context({ appId: 'application', enabled: true }); ctx.secrets.set(QQOFFICIAL_SECRET, SECRET);
  const invoke = new QQOfficialWorld({ context: ctx.value }).webUi('en').invoke!;
  const state = await invoke('configuration', 'state', []) as Record<string, unknown>;
  let status = 'connecting';
  const p = panel(() => Promise.resolve({ ...state, status }) as never);
  await bundle.panels.configuration.mount(p.ctx);
  status = 'online';
  await vi.advanceTimersByTimeAsync(2000);
  expect(p.refresh).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10000);
  expect(p.refresh).toHaveBeenCalledOnce();
});

it.each(['connection', 'configuration'] as const)('does not render %s after unmount during the initial request', async (id) => {
  let complete!: (value: unknown) => void;
  const p = panel(() => new Promise((resolve) => { complete = resolve; }) as never);
  const mounting = bundle.panels[id].mount(p.ctx);
  p.abort.abort(); complete(waitingState());
  await mounting;
  expect(p.root.childElementCount).toBe(0);
});
