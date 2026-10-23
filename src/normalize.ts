import { string, targetKey, type QQOfficialDispatch, type QQOfficialTarget, type JsonObject } from './protocol.ts';

export interface QQOfficialIncoming {
  kind: 'message' | 'notice';
  eventType: string;
  eventId?: string;
  messageId?: string;
  target?: QQOfficialTarget;
  key?: string;
  data: JsonObject;
}

/** Platform identifiers remain opaque; DMS routing uses the private guild_id. */
export function normalize(event: QQOfficialDispatch): QQOfficialIncoming {
  const d = event.d;
  let target: QQOfficialTarget | undefined;
  switch (event.t) {
    case 'C2C_MESSAGE_CREATE': {
      const author = d.author as JsonObject | undefined;
      target = { kind: 'c2c', id: string(author?.user_openid, 'author.user_openid') }; break;
    }
    case 'GROUP_AT_MESSAGE_CREATE': case 'GROUP_MESSAGE_CREATE':
      target = { kind: 'group', id: string(d.group_openid, 'group_openid') }; break;
    case 'AT_MESSAGE_CREATE': case 'MESSAGE_CREATE':
      target = { kind: 'channel', id: string(d.channel_id, 'channel_id') }; break;
    case 'DIRECT_MESSAGE_CREATE':
      target = { kind: 'dms', id: string(d.guild_id, 'guild_id') }; break;
  }
  const messageId = target ? string(d.id, 'message.id') : undefined;
  const key = messageId ? JSON.stringify([event.t, targetKey(target!), messageId]) : event.id ? JSON.stringify([event.t, event.id]) : undefined;
  return { kind: target ? 'message' : 'notice', eventType: event.t, eventId: event.id, messageId, target, key, data: d };
}
