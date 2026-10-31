// Renders the real panels with sample data for the market screenshots (see scripts/screenshots/build.mjs).
import QRCode from 'qrcode';
import * as sdkUi from 'cortico/web/client/ui/index.ts';
import bundle from '../../src/webui.js';
import { qqOfficialText } from '../../src/strings.ts';
import { qqOfficialConfigGroup, QQOFFICIAL_DEFAULTS } from '../../src/config.ts';
import { getByPath } from 'cortico/core/config-schema.ts';

const mode = location.hash.slice(1) || 'connection';
const t = qqOfficialText('zh');
const appId = '1903058820';

async function state(): Promise<Record<string, unknown>> {
  const base = { appId: '', secretSet: false, enabled: false, status: 'offline', detail: '', binding: null, text: t };
  if (mode === 'connection') {
    const url = 'https://q.qq.com/qqbot/openclaw/connect.html?task_id=example-preview&_wv=2';
    const qrDataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, width: 280 });
    return { ...base, binding: { url, qrDataUrl, expiresAtMs: Date.now() + 178_000 } };
  }
  const ready = { ...base, appId, secretSet: true, enabled: true, status: 'online' };
  if (mode === 'connected') return ready;
  const cfg = { ...structuredClone(QQOFFICIAL_DEFAULTS), enabled: true, appId };
  const group = qqOfficialConfigGroup('zh');
  const root = { worlds: { qqbot: cfg } };
  return { ...ready, group, values: Object.fromEntries(Object.keys(group.schema.properties).map((key) => [key, getByPath(root, key)])) };
}

const panelRoot = document.getElementById('panel')!;
for (const tab of document.querySelectorAll<HTMLElement>('[data-tab]')) tab.classList.toggle('on', tab.dataset.tab === (mode === 'configuration' ? 'configuration' : 'connection'));
const abort = new AbortController();
const ui = sdkUi.createWebUi({ memo: { get: (_k: string, fallback: unknown) => fallback, set: () => {} }, overlayHost: document.body, signal: abort.signal } as never);
const snapshot = await state();
const ctx = {
  root: panelRoot, signal: abort.signal, ui, pageId: 'world:qq-official', refresh: async () => {},
  invoke: async (method: string) => (method === 'poll' ? { kind: 'pending' } : snapshot),
};
await bundle.panels[mode === 'configuration' ? 'configuration' : 'connection'].mount(ctx as never);
if (mode === 'configuration') for (const fold of document.querySelectorAll('details')) fold.open = true;
document.body.dataset.ready = '1';
