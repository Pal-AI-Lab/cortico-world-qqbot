import type { Language } from 'cortico/core/language.ts';
import type { ConfigGroup } from 'cortico/core/types.ts';
import { qqOfficialText } from './strings.ts';
import { integer } from './protocol.ts';

export const QQOFFICIAL_ID = 'qqofficial';
export const QQOFFICIAL_SECRET = 'CORTICO_QQOFFICIAL_APP_SECRET';

export interface QQOfficialConfigSection {
  enabled: boolean;
  appId: string;
  transport: 'websocket' | 'webhook';
  sandbox: boolean;
  intents: number;
  webhook: { host: string; port: number; path: string; maxBodyBytes: number };
  timeoutMs: number;
  reconnectMs: number;
  maxReconnectMs: number;
  maxMediaBytes: number;
  modelLanguage: 'zh' | 'en';
}

export const QQOFFICIAL_DEFAULTS: QQOfficialConfigSection = {
  enabled: false, appId: '', transport: 'websocket', sandbox: false,
  intents: 1 << 25,
  webhook: { host: '127.0.0.1', port: 6196, path: '/qqofficial/callback', maxBodyBytes: 1024 * 1024 },
  timeoutMs: 20000, reconnectMs: 1000, maxReconnectMs: 30000,
  maxMediaBytes: 10 * 1024 * 1024, modelLanguage: 'zh',
};

export function validateConfig(cfg: QQOfficialConfigSection): void {
  if (!['websocket', 'webhook'].includes(cfg.transport)) throw new Error('Invalid transport');
  if (!['zh', 'en'].includes(cfg.modelLanguage)) throw new Error('Invalid modelLanguage');
  integer(cfg.intents, 'intents', 0, 0x7fffffff);
  integer(cfg.timeoutMs, 'timeoutMs', 100, 300000);
  integer(cfg.reconnectMs, 'reconnectMs', 10, 300000);
  integer(cfg.maxReconnectMs, 'maxReconnectMs', cfg.reconnectMs, 300000);
  integer(cfg.maxMediaBytes, 'maxMediaBytes', 1, 20 * 1024 * 1024);
  integer(cfg.webhook.port, 'webhook.port', 0, 65535);
  integer(cfg.webhook.maxBodyBytes, 'webhook.maxBodyBytes', 1, 10 * 1024 * 1024);
  if (!cfg.webhook.host || !/^\/[\w/-]+$/.test(cfg.webhook.path)) throw new Error('Invalid webhook address');
}

export function qqOfficialConfigGroup(language?: Language): ConfigGroup {
  const t = qqOfficialText(language);
  const k = 'worlds.qqofficial';
  return {
    id: 'world:qqofficial', owner: 'world:qqofficial',
    schema: { type: 'object', title: t.settings, properties: {
      [`${k}.appId`]: { type: 'string', title: t.appId, 'x-hot': false },
      [`${k}.transport`]: { type: 'string', title: t.transport, enum: ['websocket', 'webhook'], 'x-hot': false },
      [`${k}.sandbox`]: { type: 'boolean', title: t.sandbox, 'x-hot': false },
      [`${k}.intents`]: { type: 'integer', title: t.intents, minimum: 0, maximum: 0x7fffffff, 'x-hot': false },
      [`${k}.webhook.host`]: { type: 'string', title: t.host, 'x-hot': false },
      [`${k}.webhook.port`]: { type: 'integer', title: t.port, minimum: 1, maximum: 65535, 'x-hot': false },
      [`${k}.webhook.path`]: { type: 'string', title: t.path, 'x-hot': false },
      [`${k}.webhook.maxBodyBytes`]: { type: 'integer', title: t.maxBodyBytes, minimum: 1, maximum: 10 * 1024 * 1024, 'x-hot': false },
      [`${k}.timeoutMs`]: { type: 'integer', title: t.timeoutMs, minimum: 100, maximum: 300000, 'x-suffix': 'ms', 'x-hot': false },
      [`${k}.reconnectMs`]: { type: 'integer', title: t.reconnectMs, minimum: 10, maximum: 300000, 'x-suffix': 'ms', 'x-hot': false },
      [`${k}.maxReconnectMs`]: { type: 'integer', title: t.maxReconnectMs, minimum: 10, maximum: 300000, 'x-suffix': 'ms', 'x-hot': false },
      [`${k}.maxMediaBytes`]: { type: 'integer', title: t.maxMediaBytes, minimum: 1, maximum: 20 * 1024 * 1024, 'x-hot': true },
      [`${k}.modelLanguage`]: { type: 'string', title: t.modelLanguage, enum: ['zh', 'en'], 'x-hot': true },
    } },
  };
}
