/** @typedef {{ appId: string, secretSet: boolean, text: import('./strings.ts').QQOfficialStrings }} ConnectionState */
/** @typedef {{ url?: string, message?: string, kind?: 'pending' | 'expired' | 'bound' }} ConnectionResult */
/** @type {import('cortico/web/shared/client-panel.ts').WebUiClientBundle} */
const bundle = {
  panels: {
    connection: {
      async mount(ctx) {
        /** @type {ConnectionState} */
        const state = await ctx.invoke('state');
        if (ctx.signal.aborted) return;
        const t = state.text;
        const { ui } = ctx;
        const appId = ui.input({ value: state.appId });
        const secret = ui.input({ type: 'password', placeholder: state.secretSet ? t.secretSet : t.secretMissing });
        const message = ui.msgline();
        const link = ui.h('a', null, t.open);
        link.target = '_blank'; link.rel = 'noopener noreferrer'; link.hidden = true;
        /** @param {HTMLButtonElement} button @param {string} method @param {unknown[]} args */
        const run = async (button, method, args = []) => {
          button.disabled = true;
          try {
            /** @type {ConnectionResult} */
            const result = await ctx.invoke(method, args);
            if (ctx.signal.aborted) return;
            if (result.url) { link.href = result.url; link.hidden = false; poll.disabled = false; }
            message.textContent = result.message ?? t.pending;
            if (method === 'save' || result.kind === 'bound') {
              secret.value = '';
              /** @type {ConnectionState} */
              const next = await ctx.invoke('state');
              if (ctx.signal.aborted) return;
              appId.value = next.appId;
              secret.placeholder = next.secretSet ? t.secretSet : t.secretMissing;
              await ctx.refresh();
            }
            if (result.kind === 'bound' || result.kind === 'expired') { link.hidden = true; poll.disabled = true; }
          } catch (error) { if (!ctx.signal.aborted) message.textContent = String(error); }
          finally { if (button !== poll || !link.hidden) button.disabled = false; }
        };
        const save = ui.button(t.save, { onClick: () => { void run(save, 'save', [{ appId: appId.value.trim(), secret: secret.value.trim() }]); } });
        const bind = ui.button(t.bind, { onClick: () => { void run(bind, 'bind'); } });
        const poll = ui.button(t.poll, { onClick: () => { void run(poll, 'poll'); } });
        poll.disabled = true;
        const actions = ui.actions(); actions.append(save, bind, link, poll);
        ctx.root.append(ui.field(t.appId, appId), ui.field('AppSecret', secret), actions, message);
      },
    },
  },
};

export default bundle;
