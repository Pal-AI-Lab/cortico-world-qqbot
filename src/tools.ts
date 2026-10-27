import type { ToolDef, ToolOutcome } from 'cortico/core/types.ts';
import { QQOFFICIAL_MODEL_TEXT, type ModelLanguage } from './model-text.ts';

const text = { type: 'string' };
const to = { type: 'string', description: 'c2c:<OpenID>, group:<group OpenID>, channel:<id> or dms:<id>' };
const message = { type: 'string', description: '#<n> from the start of a message line' };
const anchors = { to, reply_to: message, eventId: text, delivery: { type: 'string', enum: ['auto', 'reply', 'proactive', 'wakeup'] }, fallback: { type: 'boolean' } };
const format = { type: 'string', enum: ['text', 'markdown'] };
export type QQOfficialAction = 'send' | 'media' | 'stream' | 'remove' | 'history' | 'interaction' | 'read' | 'targets';
const media = { url: text, blob: text, fileType: { type: 'integer', minimum: 1, maximum: 4 }, fileName: text, text };

export function qqOfficialTools(language: ModelLanguage, execute: (action: QQOfficialAction, args: Record<string, unknown>, signal?: AbortSignal) => Promise<string | ToolOutcome>): ToolDef[] {
  const t = QQOFFICIAL_MODEL_TEXT[language];
  const define = (action: QQOfficialAction, name: string, properties: Record<string, unknown>, required: string[], tags: ToolDef['tags']): ToolDef => ({
    name: `qqofficial_${name}`, description: t[action], tags,
    parameters: { type: 'object', properties, required, additionalProperties: false },
    handler: async (args, ctx) => {
      try { return await execute(action, args, ctx.signal); }
      catch (error) { return { text: `${tags?.includes('speak') ? t.sendFailed : t.toolFailed} ${error instanceof Error ? error.message : String(error)}`, failed: true }; }
    },
  });
  return [
    define('send', 'send_message', { ...anchors, text, image: text, voice: text, quote: { type: 'boolean' }, format, keyboard: { type: 'object' } }, [], ['speak']),
    define('media', 'send_media', { ...anchors, ...media, items: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, properties: media, required: ['fileType'] } } }, [], ['speak']),
    define('stream', 'stream_message', { ...anchors, text, format, streamId: text, finish: { type: 'boolean' }, followModel: { type: 'boolean' } }, [], ['speak']),
    define('remove', 'delete_message', { message }, ['message'], ['act']),
    define('history', 'read_history', { to, before: message, limit: { type: 'integer', minimum: 1, maximum: 100 } }, [], ['read']),
    define('read', 'read_attachment', { message, index: { type: 'integer', minimum: 1, maximum: 100 }, quoted: { type: 'boolean' } }, ['message'], ['read']),
    define('targets', 'list_targets', { limit: { type: 'integer', minimum: 1, maximum: 100 } }, [], ['read']),
    define('interaction', 'ack_interaction', { interactionId: text, code: { type: 'integer', minimum: 0, maximum: 5 } }, ['interactionId', 'code'], ['act']),
  ];
}
