/** @typedef {import('./binding.ts').QQOfficialBindingTask} BindingTask */
/** @typedef {{ appId: string, secretSet: boolean, enabled: boolean, status: 'offline' | 'connecting' | 'online' | 'error', detail: string, binding: BindingTask | null, text: import('./strings.ts').QQOfficialStrings }} ConnectionState */
/** @typedef {ConnectionState & { group: import('cortico/core/types.ts').ConfigGroup, values: Record<string, string | number | boolean> }} ConfigurationState */
/** @typedef {{ kind?: 'pending' | 'expired' | 'bound', appId?: string, connectionError?: string }} ConnectionResult */
/** @typedef {import('cortico/web/shared/client-panel.ts').WebUiPanelContext} PanelContext */

const css = [
  '.qq-connect{max-width:760px;margin:28px auto;color:var(--ink);}',
  '.qq-connect [hidden]{display:none!important;}',
  '.qq-connect-card{border:1px solid var(--line);border-radius:24px;padding:38px 32px;text-align:center;background:var(--paper);}',
  '.qq-connect-brand{font-size:11px;letter-spacing:.16em;color:var(--ink-dim);margin-bottom:22px;}',
  '.qq-connect-icon{display:grid;place-items:center;width:68px;height:68px;border-radius:22px;margin:0 auto 22px;background:var(--hover);color:var(--ink-soft);font-size:23px;font-weight:600;}',
  '.qq-connect-icon.ok{border-radius:50%;color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,transparent);font-size:32px;}',
  '.qq-connect h2{font-size:26px;line-height:1.4;margin:0 0 12px;font-weight:600;letter-spacing:-.025em;}',
  '.qq-connect-desc{color:var(--ink-soft);font-size:14px;line-height:1.85;max-width:460px;margin:0 auto;}',
  '.qq-qr-frame{width:280px;max-width:100%;background:#fff;border-radius:18px;padding:8px;box-sizing:content-box;margin:26px auto 14px;border:1px solid var(--line);}',
  '.qq-qr-frame img{display:block;width:100%;height:auto;border-radius:10px;}',
  '.qq-qr-time{font-size:12px;font-variant-numeric:tabular-nums;color:var(--ink-dim);margin:12px 0 18px;}',
  '.qq-connect-actions{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:12px;margin-top:26px;}',
  '.qq-connect-actions .btn{min-height:40px;padding:9px 18px;}',
  '.qq-connect-status{max-width:370px;margin:26px auto 0;padding:4px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);text-align:left;}',
  '.qq-connect-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 2px;font-size:13px;color:var(--ink-soft);}',
  '.qq-connect-value{color:var(--ink);}.qq-connect-value.ok{color:var(--ok);}',
  '.qq-connect-footer{text-align:center;margin-top:20px;font-size:12px;color:var(--ink-dim);}',
  '.qq-connect-error{margin-top:18px;font-size:13px;line-height:1.7;overflow-wrap:anywhere;color:var(--ink-soft);}',
  '.qq-configuration{max-width:860px;margin:24px auto;}.qq-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 24px;border:0;padding:0;margin:18px 0;min-width:0;}',
  '.qq-settings-grid .fieldrow{margin:0;min-width:0;}.qq-settings-grid .field{width:100%;box-sizing:border-box;}.qq-config-note{color:var(--ink-soft);font-size:13px;line-height:1.8;margin-bottom:22px;}',
  '@media(max-width:620px){.qq-connect{margin:16px 0;}.qq-connect-card{padding:28px 20px;border-radius:18px;}.qq-connect h2{font-size:23px;}.qq-qr-frame{width:240px;max-width:calc(100% - 18px);}.qq-settings-grid{grid-template-columns:1fr;}}',
].join('\n');

/** @param {PanelContext} ctx */
function addStyle(ctx) { const style = ctx.ui.h('style'); style.textContent = css; ctx.root.append(style); }

/** @param {PanelContext} ctx */
async function mountConnection(ctx) {
  /** @type {ConnectionState} */
  let state = await ctx.invoke('state');
  if (ctx.signal.aborted) return;
  const { ui } = ctx;
  const t = state.text;
  addStyle(ctx);
  const layout = ui.h('div', 'qq-connect');
  const card = ui.h('section', 'qq-connect-card');
  const message = ui.h('div', 'qq-connect-error');
  message.setAttribute('role', 'status');
  const footer = ui.h('div', 'qq-connect-footer');
  const settings = ui.h('a', null, t.manageConfig);
  settings.href = '#/provider/' + encodeURIComponent(ctx.pageId || 'world:qqofficial') + '/configuration';
  footer.append(settings);
  layout.append(card, message, footer); ctx.root.append(layout);
  let busy = false;
  let expired = false;
  let generation = 0;
  /** @type {HTMLElement | null} */
  let countdown = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let clock;
  const cancel = () => { generation++; clearTimeout(timer); clearTimeout(clock); };
  /** @param {number} version */
  const active = (version) => !ctx.signal.aborted && version === generation;
  ctx.signal.addEventListener('abort', cancel, { once: true });
  const configured = () => !!state.appId && state.secretSet;
  /** @param {string} value */
  const notify = (value) => { message.textContent = value; message.hidden = !value; };

  function render() {
    const waiting = !!state.binding;
    const ready = configured();
    const online = ready && state.enabled && state.status === 'online';
    card.replaceChildren(); countdown = null;
    card.append(ui.h('div', 'qq-connect-brand', 'QQ OFFICIAL'));
    if (!waiting) card.append(ui.h('div', 'qq-connect-icon' + (online ? ' ok' : ''), online ? '✓' : 'QQ'));
    const title = waiting ? t.scanTitle : online ? t.success : busy && !ready ? t.qrLoading
      : ready && state.status === 'connecting' ? t.connecting : ready && state.status === 'error' ? t.error : t.connect;
    card.append(ui.h('h2', null, title), ui.h('p', 'qq-connect-desc', waiting ? t.scanHint : online ? t.successHint : ready ? t.configuredHint : t.intro));
    if (state.binding) {
      const frame = ui.h('div', 'qq-qr-frame');
      const qr = ui.h('img'); qr.src = state.binding.qrDataUrl; qr.alt = t.qrAlt; qr.width = qr.height = 280;
      frame.append(qr); card.append(frame);
      countdown = ui.h('div', 'qq-qr-time'); card.append(countdown); updateClock();
      const link = ui.h('a', 'qq-binding-link', t.open);
      link.href = state.binding.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);
    } else if (ready) {
      const status = ui.h('div', 'qq-connect-status');
      const authorized = ui.h('div', 'qq-connect-row');
      authorized.append(ui.h('span', null, t.authorized), ui.h('span', 'qq-connect-value ok', '✓'));
      const channel = ui.h('div', 'qq-connect-row');
      channel.append(ui.h('span', null, t.channel), ui.h('span', 'qq-connect-value' + (online ? ' ok' : ''), online ? t.online : t[state.status]));
      status.append(authorized, channel); card.append(status);
    }
    const actions = ui.h('div', 'qq-connect-actions');
    /** @param {string} label @param {string} method @param {boolean} primary */
    const action = (label, method, primary = false) => {
      const button = ui.button(label, { variant: primary ? 'primary' : 'plain', onClick: () => { void run(method); } });
      button.disabled = busy; actions.append(button);
    };
    if (waiting) { action(t.refreshQr, 'bind'); action(t.cancel, 'cancel'); }
    else if (ready) { if (!online) action(t.connect, 'connect', true); action(t.rebind, 'bind'); }
    else action(expired ? t.refreshQr : t.scanTitle, 'bind', true);
    card.append(actions);
    card.setAttribute('aria-busy', String(busy));
  }

  function updateClock() {
    if (!countdown || !state.binding) return;
    const remaining = Math.max(0, Math.ceil((state.binding.expiresAtMs - Date.now()) / 1000));
    countdown.textContent = t.expiresIn + ' ' + Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
  }

  function watch() {
    cancel();
    const version = generation;
    const tick = () => {
      if (!active(version) || !state.binding) return;
      if (Date.now() >= state.binding.expiresAtMs) {
        state = { ...state, binding: null }; expired = true; render(); notify(t.expired); watch(); return;
      }
      updateClock(); clock = setTimeout(tick, 1000);
    };
    const schedule = () => {
      if (active(version) && (state.binding || configured())) timer = setTimeout(check, state.binding || state.status !== 'online' ? 2000 : 5000);
    };
    const check = async () => {
      if (!active(version)) return;
      try {
        if (state.binding) {
          /** @type {ConnectionResult} */
          const result = await ctx.invoke('poll');
          if (!active(version)) return;
          if (result.kind === 'pending') { notify(''); schedule(); return; }
          if (result.kind === 'bound' || result.kind === 'expired') {
            expired = result.kind === 'expired';
            // Remove the QR immediately, including when the next state request needs a retry.
            state = { ...state, binding: null, ...(result.kind === 'bound' ? { appId: result.appId || state.appId, secretSet: true, enabled: true, status: 'connecting' } : {}) };
            render(); notify(result.connectionError || (expired ? t.expired : ''));
          }
        }
        /** @type {ConnectionState} */
        const next = await ctx.invoke('state');
        if (!active(version)) return;
        const changed = JSON.stringify(state) !== JSON.stringify(next);
        state = next;
        if (changed) render();
        if (state.status === 'online') { expired = false; notify(''); }
        else if (state.status === 'error') notify(state.detail);
        await ctx.refresh();
        if (!active(version)) return;
        watch();
      } catch (error) { if (active(version)) { notify(String(error)); schedule(); } }
    };
    tick(); schedule();
  }

  /** @param {string} method */
  async function run(method) {
    cancel();
    const version = generation;
    busy = true; expired = false; notify(''); render();
    try {
      if (method === 'bind') {
        /** @type {BindingTask} */
        const binding = await ctx.invoke('bind');
        if (!active(version)) return;
        state = { ...state, binding };
      } else {
        /** @type {ConnectionResult} */
        const result = await ctx.invoke(method);
        if (!active(version)) return;
        const next = await ctx.invoke('state');
        if (!active(version)) return;
        state = /** @type {ConnectionState} */ (next);
        notify(result.connectionError || '');
        await ctx.refresh();
      }
    } catch (error) { if (active(version)) notify(String(error)); }
    finally { if (active(version)) { busy = false; render(); watch(); } }
  }
  render(); notify(state.status === 'error' ? state.detail : ''); watch();
}

/** @param {PanelContext} ctx */
async function mountConfiguration(ctx) {
  /** @type {ConfigurationState} */
  const state = await ctx.invoke('state');
  if (ctx.signal.aborted) return;
  const { ui } = ctx;
  const t = state.text;
  addStyle(ctx);
  const layout = ui.h('div', 'qq-configuration');
  layout.append(ui.section(t.credentials, t.configHint));
  const credentials = ui.h('fieldset', 'qq-settings-grid');
  const appId = ui.input({ value: state.appId }); appId.autocomplete = 'off';
  const secret = ui.input({ type: 'password', placeholder: state.secretSet ? t.secretSet : t.secretMissing }); secret.autocomplete = 'new-password';
  credentials.append(ui.field(t.appId, appId), ui.field('AppSecret', secret));
  const advanced = ui.foldSheet('connection-settings', { title: t.settings, defaultOpen: false });
  const fields = ui.h('fieldset', 'qq-settings-grid');
  /** @type {Record<string, () => string | number | boolean>} */
  const values = { 'worlds.qqofficial.appId': () => appId.value.trim() };
  for (const [key, property] of Object.entries(state.group.schema.properties)) {
    if (key === 'worlds.qqofficial.appId') continue;
    if (property.type === 'boolean') {
      const checkbox = ui.checkbox(property.title, { checked: state.values[key] === true });
      values[key] = () => checkbox.checked; fields.append(checkbox.el);
    } else {
      const numeric = property.type === 'integer' || property.type === 'number';
      const control = property.enum ? ui.select({ value: String(state.values[key]), options: property.enum })
        : ui.input({ value: String(state.values[key]), type: numeric ? 'number' : 'text' });
      if (numeric) {
        const input = /** @type {HTMLInputElement} */ (control);
        if (property.minimum !== undefined) input.min = String(property.minimum);
        if (property.maximum !== undefined) input.max = String(property.maximum);
        input.step = property.type === 'integer' ? '1' : 'any';
      }
      values[key] = () => numeric ? Number(control.value) : control.value;
      fields.append(ui.field(property.title + (property['x-suffix'] ? ' (' + property['x-suffix'] + ')' : ''), control));
    }
  }
  advanced.body.append(fields);
  const message = ui.msgline(); message.setAttribute('role', 'status');
  const save = ui.button(t.saveConfig, { variant: 'primary', onClick: () => { void commit(); } });
  const actions = ui.actions(); actions.append(save);
  layout.append(credentials, advanced.el, actions, message); ctx.root.append(layout);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let statusTimer;
  let statusVersion = 0;
  const cancelStatus = () => { statusVersion++; clearTimeout(statusTimer); };
  ctx.signal.addEventListener('abort', cancelStatus, { once: true });
  /** @param {ConfigurationState} current */
  function followConnection(current) {
    cancelStatus();
    if (!current.enabled || current.status !== 'connecting') return;
    const version = statusVersion;
    statusTimer = setTimeout(async () => {
      try {
        /** @type {ConfigurationState} */
        const next = await ctx.invoke('state');
        if (ctx.signal.aborted || version !== statusVersion) return;
        await ctx.refresh();
        if (!ctx.signal.aborted && version === statusVersion) followConnection(next);
      } catch (error) { if (!ctx.signal.aborted && version === statusVersion) message.textContent = String(error); }
    }, 2000);
  }
  followConnection(state);
  async function commit() {
    cancelStatus();
    save.disabled = credentials.disabled = fields.disabled = true;
    try {
      /** @type {{ message: string, connectionError?: string }} */
      const result = await ctx.invoke('save', [{ values: Object.fromEntries(Object.entries(values).map(([key, read]) => [key, read()])), secret: secret.value.trim() }]);
      if (ctx.signal.aborted) return;
      secret.value = '';
      /** @type {ConfigurationState} */
      const next = await ctx.invoke('state');
      if (ctx.signal.aborted) return;
      appId.value = next.appId;
      secret.placeholder = next.secretSet ? t.secretSet : t.secretMissing;
      message.textContent = result.message + (result.connectionError ? ' ' + result.connectionError : '');
      await ctx.refresh();
      if (!ctx.signal.aborted) followConnection(next);
    } catch (error) { if (!ctx.signal.aborted) message.textContent = String(error); }
    finally { if (!ctx.signal.aborted) save.disabled = credentials.disabled = fields.disabled = false; }
  }
}

/** @type {import('cortico/web/shared/client-panel.ts').WebUiClientBundle} */
const bundle = { panels: { connection: { mount: mountConnection }, configuration: { mount: mountConfiguration } } };
export default bundle;
