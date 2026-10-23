import type { ToolDef, ToolOutcome } from 'cortico/core/types.ts';
import { QQOFFICIAL_MODEL_TEXT, type ModelLanguage } from './model-text.ts';

const target = {
  type: 'object', additionalProperties: false, required: ['kind', 'id'],
  properties: { kind: { type: 'string', enum: ['c2c', 'group', 'channel', 'dms'] }, id: { type: 'string', minLength: 1 } },
};
const text = { type: 'string' };
const anchors = { replyTo: text, eventId: text };
const format = { type: 'string', enum: ['text', 'markdown'] };
export type QQOfficialAction = 'send' | 'media' | 'stream' | 'remove' | 'history' | 'interaction' | 'read';

export function qqOfficialTools(language: ModelLanguage, execute: (action: QQOfficialAction, args: Record<string, unknown>, signal?: AbortSignal) => Promise<string | ToolOutcome>): ToolDef[] {
  const t = QQOFFICIAL_MODEL_TEXT[language];
  const define = (action: QQOfficialAction, name: string, properties: Record<string, unknown>, required: string[], tags: ToolDef['tags']): ToolDef => ({
    name: `qqofficial_${name}`, description: t[action], tags,
    parameters: { type: 'object', properties, required, additionalProperties: false },
    handler: async (args, ctx) => {
      try { return await execute(action, args, ctx.signal); }
      catch (error) { return { text: t.failed + (error instanceof Error ? error.message : String(error)), failed: true }; }
    },
  });
  return [
    define('send', 'send_message', { target, content: text, format, ...anchors, referenceId: text, keyboard: { type: 'object' } }, ['target', 'content'], ['speak']),
    define('media', 'send_media', { target, url: text, blob: text, fileType: { type: 'integer', minimum: 1, maximum: 4 }, fileName: text, content: text, ...anchors }, ['target', 'fileType'], ['speak']),
    define('stream', 'stream_message', { target, content: text, format, ...anchors, streamId: text, finish: { type: 'boolean' } }, ['target', 'content'], ['speak']),
    define('remove', 'delete_message', { target, messageId: text }, ['target', 'messageId'], ['act']),
    define('history', 'history', { target, beforeCursor: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, [], ['read']),
    define('read', 'read_attachment', { cursor: { type: 'integer', minimum: 1 }, index: { type: 'integer', minimum: 0 } }, ['cursor', 'index'], ['read']),
    define('interaction', 'ack_interaction', { interactionId: text, code: { type: 'integer', minimum: 0, maximum: 5 } }, ['interactionId', 'code'], ['act']),
  ];
}
