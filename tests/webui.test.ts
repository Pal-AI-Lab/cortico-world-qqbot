import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createWebUi } from 'cortico/web/client/ui/index.ts';
import type { WebUiPanelContext, WebUiMemo } from 'cortico/web/shared/client-panel.ts';
import bundle from '../src/webui.js';
import { QQOfficialWorld } from '../src/world.ts';
import { QQOFFICIAL_SECRET } from '../src/config.ts';
import { qqOfficialText } from '../src/strings.ts';
import { context, SECRET } from './helpers.ts';

let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>');
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('AbortController', dom.window.AbortController);
});
afterEach(() => { dom.window.close(); vi.unstubAllGlobals(); });
function panel(invoke: WebUiPanelContext['invoke']) {
  const abort = new AbortController();
  const root = document.createElement('div'); document.body.append(root);
  const memo: WebUiMemo = { get: (_key, fallback) => fallback, set: () => {} };
  const ui = createWebUi({ memo, overlayHost: document.body, signal: abort.signal });
  return { abort, root, ctx: { root, invoke, signal: abort.signal, ui, refresh: async () => {} } as unknown as WebUiPanelContext };
}

it('saves credentials through the World and clears the password input after success', async () => {
  const state = context();
  const world = new QQOfficialWorld({ context: state.value });
  const invoke = world.webUi('en').invoke!;
  const p = panel((method, args = []) => invoke('connection', method, args) as never);
  await bundle.panels.connection.mount(p.ctx);
  const inputs = p.root.querySelectorAll('input');
  inputs[0].value = 'application'; inputs[1].value = SECRET;
  p.root.querySelector('button')!.click();
  await vi.waitFor(() => expect(inputs[1].value).toBe(''));
  expect(state.value.secret(QQOFFICIAL_SECRET)).toBe(SECRET);
  expect(state.value.cfg.appId).toBe('application');
  expect(inputs[1].placeholder).toBe(qqOfficialText('en').secretSet);
  expect(p.root.textContent).not.toContain(SECRET);
  p.abort.abort();
});

it('does not render a panel after it is unmounted during the initial request', async () => {
  let complete!: (value: unknown) => void;
  const p = panel(() => new Promise((resolve) => { complete = resolve; }) as never);
  const mounting = bundle.panels.connection.mount(p.ctx);
  p.abort.abort(); complete({ appId: '', secretSet: false, text: qqOfficialText('en') });
  await mounting;
  expect(p.root.childElementCount).toBe(0);
});
