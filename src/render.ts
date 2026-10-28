import { shortTime } from 'cortico/core/util.ts';
import { QFACE_NAMES } from './qface-map.ts';
import type { ModelLanguage } from './model-text.ts';
import type { JsonObject, QQOfficialTarget } from './protocol.ts';

/** Text shown to the model. Lines follow Cortico's built-in QQ World: `#ref [conversation HH:MM] sender: body`. */
const TEXT = {
  zh: {
    c2c: '私聊', group: (id: string) => `群 ${id}`, channel: (id: string) => `频道 ${id}`, dms: '频道私信',
    user: (id: string) => `用户${id}`, member: (id: string) => `成员${id}`, you: '你', everyone: '@全体成员',
    face: (name: string) => `[表情:${name}]`, faceUnknown: '[QQ表情]',
    image: '[图片]', voice: '[语音]', transcript: (text: string) => `[语音] ${text}`,
    video: (name: string) => name ? `[视频 ${name}]` : '[视频]', file: (name: string) => name ? `[文件 ${name}]` : '[文件]',
    reply: (ref: string) => `[回复#${ref}]`, quote: (body: string) => `[回复「${body}」]`,
    friendAdd: '添加了你', friendDel: '删除了你', c2cReject: '关闭了你的主动消息', c2cReceive: '开启了你的主动消息',
    groupAdd: '你被拉进了这个群', groupDel: '你被移出了这个群', groupReject: '这个群关闭了你的主动消息', groupReceive: '这个群开启了你的主动消息',
    interaction: (id: string, value: string) => `点了按钮 ${value}(互动 ${id})`,
    streamRejected: '流式回复的一个分片被拒绝,之前发出的部分保留。',
    streamBuffered: (reason: string) => `这个会话不支持流式回复(${reason}),整段回复会在本轮结束后发出。`,
    streamFailed: (error: string) => `流式回复中断:${error}。已经发出的部分对方能看到,不要整段重发。`,
    unknown: (type: string) => `QQ 平台事件 ${type}`, system: '[系统]',
    modes: { reply: '被动回复', proactive: '主动消息', wakeup: '召回消息' } as Record<string, string>,
    fallback: { proactive: '回复依据失效，已改为主动消息', text: '没有 Markdown 权限，已改为纯文本' } as Record<string, string>,
  },
  en: {
    c2c: 'DM', group: (id: string) => `group ${id}`, channel: (id: string) => `channel ${id}`, dms: 'guild DM',
    user: (id: string) => `user ${id}`, member: (id: string) => `member ${id}`, you: 'you', everyone: '@everyone',
    face: (name: string) => `[emoji:${name}]`, faceUnknown: '[QQ emoji]',
    image: '[image]', voice: '[voice]', transcript: (text: string) => `[voice] ${text}`,
    video: (name: string) => name ? `[video ${name}]` : '[video]', file: (name: string) => name ? `[file ${name}]` : '[file]',
    reply: (ref: string) => `[reply to #${ref}]`, quote: (body: string) => `[reply to "${body}"]`,
    friendAdd: 'added you', friendDel: 'removed you', c2cReject: 'turned off your proactive messages', c2cReceive: 'turned on your proactive messages',
    groupAdd: 'you were added to this group', groupDel: 'you were removed from this group',
    groupReject: 'this group turned off your proactive messages', groupReceive: 'this group turned on your proactive messages',
    interaction: (id: string, value: string) => `pressed button ${value} (interaction ${id})`,
    streamRejected: 'A streamed reply part was rejected; earlier parts remain.',
    streamBuffered: (reason: string) => `This conversation does not support streamed replies (${reason}); the whole reply is sent when the round ends.`,
    streamFailed: (error: string) => `The streamed reply stopped: ${error}. The recipient can see what was already sent; do not resend the whole reply.`,
    unknown: (type: string) => `QQ platform event ${type}`, system: '[system]',
    modes: { reply: 'reply', proactive: 'proactive message', wakeup: 'wakeup message' } as Record<string, string>,
    fallback: { proactive: 'the reply anchor expired, sent as a proactive message', text: 'no Markdown permission, sent as plain text' } as Record<string, string>,
  },
};
export type RenderText = typeof TEXT.zh;
export function renderText(language: ModelLanguage): RenderText { return TEXT[language]; }

/** OpenIDs are 32 characters; the tail is enough to tell people apart on a line. */
export function shortId(id: string): string { return id.length > 6 ? id.slice(-6) : id; }

export function address(target: QQOfficialTarget): string { return `${target.kind}:${target.id}`; }

export function conversationLabel(target: QQOfficialTarget, t: RenderText): string {
  if (target.kind === 'c2c') return t.c2c;
  if (target.kind === 'dms') return t.dms;
  return target.kind === 'group' ? t.group(shortId(target.id)) : t.channel(shortId(target.id));
}

function str(value: unknown): string { return typeof value === 'string' ? value : ''; }

/** Channel events carry names; C2C and group events carry only OpenIDs. */
export function senderName(data: JsonObject, t: RenderText): string {
  const author = (data.author ?? {}) as JsonObject;
  const member = (data.member ?? {}) as JsonObject;
  const named = str(member.nick) || str(author.username);
  if (named) return named;
  if (str(author.user_openid)) return t.user(shortId(str(author.user_openid)));
  if (str(author.member_openid)) return t.member(shortId(str(author.member_openid)));
  return t.user(shortId(str(author.id) || '?'));
}

function decodeFace(tag: string, t: RenderText): string {
  const ext = /ext="([^"]*)"/.exec(tag)?.[1];
  if (ext) {
    try {
      const name = str((JSON.parse(Buffer.from(ext, 'base64').toString('utf8')) as JsonObject).text).replace(/^\[|\]$/g, '');
      if (name) return t.face(name);
    } catch { /* fall back to the face id */ }
  }
  const id = /faceId="?(\d+)/.exec(tag)?.[1];
  return id && QFACE_NAMES[id] ? t.face(QFACE_NAMES[id]) : t.faceUnknown;
}

interface Mention { id?: unknown; username?: unknown; is_you?: unknown; bot?: unknown; member_openid?: unknown; user_openid?: unknown }

function renderContent(content: string, data: JsonObject, t: RenderText, selfId?: string): { text: string; mentionedSelf: boolean } {
  const mentions = Array.isArray(data.mentions) ? data.mentions as Mention[] : [];
  let mentionedSelf = false;
  const mention = (id: string): string => {
    const found = mentions.find(m => [m.id, m.member_openid, m.user_openid].map(String).includes(id));
    if ((found && (found.is_you === true || (found.bot === true && !selfId))) || (selfId && id === selfId)) { mentionedSelf = true; return `@${t.you}`; }
    return `@${str(found?.username) || shortId(id)}`;
  };
  const text = content
    .replace(/<faceType=\d+[^>]*>/g, tag => ` ${decodeFace(tag, t)} `)
    // Older payloads write faces as [<face,id=13/>].
    .replace(/\[<face,id=(\d+)\s*\/>\]|<emoji:(\d+)>/g, (_, a?: string, b?: string) => {
      const id = a ?? b ?? '';
      return ` ${QFACE_NAMES[id] ? t.face(QFACE_NAMES[id]) : t.faceUnknown} `;
    })
    .replace(/<qqbot-at-everyone\s*\/>|@everyone/g, ` ${t.everyone} `)
    .replace(/<qqbot-at-user\s+id="([^"]+)"\s*\/>/g, (_, id: string) => ` ${mention(id)} `)
    .replace(/<@!?([^>\s]+)>/g, (_, id: string) => ` ${mention(id)} `)
    .replace(/[ \t]{2,}/g, ' ').trim();
  return { text, mentionedSelf };
}

export interface AttachmentView { index: number; kind: 'image' | 'voice' | 'video' | 'file'; url: string; name: string; mime: string; asr?: string }

export function attachmentsOf(data: JsonObject): AttachmentView[] {
  const list = Array.isArray(data.attachments) ? data.attachments as JsonObject[] : [];
  return list.map((a, index) => {
    const mime = str(a.content_type) || str(a.contentType);
    const name = str(a.filename);
    const kind = /^image/i.test(mime) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name) ? 'image'
      : /^(voice|audio)/i.test(mime) || /\.(silk|amr|wav|mp3|ogg|m4a)$/i.test(name) ? 'voice'
        : /^video/i.test(mime) || /\.(mp4|mov|avi|mkv)$/i.test(name) ? 'video' : 'file';
    return { index, kind, url: str(a.url), name, mime, ...(str(a.asr_refer_text) ? { asr: str(a.asr_refer_text) } : {}) };
  });
}

function attachmentToken(a: AttachmentView, t: RenderText): string {
  if (a.kind === 'image') return t.image;
  if (a.kind === 'voice') return a.asr ? t.transcript(a.asr) : t.voice;
  return a.kind === 'video' ? t.video(a.name) : t.file(a.name);
}

function renderBody(data: JsonObject, t: RenderText, selfId?: string) {
  const { text, mentionedSelf } = renderContent(str(data.content), data, t, selfId);
  const tokens = attachmentsOf(data).map(a => attachmentToken(a, t));
  return { body: [text, ...tokens].filter(Boolean).join(' '), mentionedSelf };
}

export interface IncomingContext {
  t: RenderText;
  timezone: string;
  ref: string;
  target: QQOfficialTarget;
  eventType: string;
  selfId?: string;
  /** Local reference of an earlier recorded message, by its QQ message id. */
  refOf: (messageId: string) => string | undefined;
}

export function renderIncoming(data: JsonObject, ctx: IncomingContext): { text: string; mentionedSelf: boolean } {
  const { t } = ctx;
  let quote = '';
  if (Number(data.message_type) === 103 && Array.isArray(data.msg_elements) && data.msg_elements.length) {
    const element = data.msg_elements[0] as JsonObject;
    const quotedId = str((data.message_reference as JsonObject | undefined)?.message_id) || str(element.message_id) || str(element.id);
    const known = quotedId ? ctx.refOf(quotedId) : undefined;
    if (known) quote = t.reply(known);
    else {
      const quoted = renderBody(element, t, ctx.selfId).body;
      quote = t.quote(quoted.length > 80 ? `${quoted.slice(0, 80)}…` : quoted);
    }
  }
  const { body, mentionedSelf } = renderBody(data, t, ctx.selfId);
  // A group @-message is addressed to the bot even though QQ strips the mention from its text.
  const atSelf = ctx.eventType === 'GROUP_AT_MESSAGE_CREATE' && !mentionedSelf ? `@${t.you}` : '';
  const when = str(data.timestamp) ? new Date(str(data.timestamp)) : new Date();
  const time = shortTime(ctx.timezone, Number.isNaN(when.getTime()) ? new Date() : when);
  const line = [quote, atSelf, body].filter(Boolean).join(' ');
  return {
    text: `#${ctx.ref} [${conversationLabel(ctx.target, t)} ${time}] ${senderName(data, t)}: ${line}`,
    mentionedSelf: mentionedSelf || ctx.eventType === 'GROUP_AT_MESSAGE_CREATE' || ctx.eventType === 'AT_MESSAGE_CREATE',
  };
}

export function renderNotice(eventType: string, data: JsonObject, target: QQOfficialTarget | undefined, t: RenderText): string {
  const where = target ? `${conversationLabel(target, t)} ` : '';
  const who = str(data.openid) ? `${t.user(shortId(str(data.openid)))} ` : '';
  const line = (text: string) => `${t.system} ${where}${text}`.replace(/\s+$/, '');
  switch (eventType) {
    case 'FRIEND_ADD': return line(`${who}${t.friendAdd}`);
    case 'FRIEND_DEL': return line(`${who}${t.friendDel}`);
    case 'C2C_MSG_REJECT': return line(`${who}${t.c2cReject}`);
    case 'C2C_MSG_RECEIVE': return line(`${who}${t.c2cReceive}`);
    case 'GROUP_ADD_ROBOT': return line(t.groupAdd);
    case 'GROUP_DEL_ROBOT': return line(t.groupDel);
    case 'GROUP_MSG_REJECT': return line(t.groupReject);
    case 'GROUP_MSG_RECEIVE': return line(t.groupReceive);
    case 'INTERACTION_CREATE': {
      const resolved = ((data.data as JsonObject | undefined)?.resolved ?? {}) as JsonObject;
      const actor = str(data.group_member_openid) || str(data.user_openid);
      return line(`${actor ? `${t.user(shortId(actor))} ` : ''}${t.interaction(str(data.id), str(resolved.button_data) || str(resolved.button_id))}`);
    }
    case 'STREAM_PART_REJECTED': return line(t.streamRejected);
    case 'REPLY_STREAM_BUFFERED': return line(t.streamBuffered(str(data.reason)));
    case 'REPLY_STREAM_FAILED': return line(t.streamFailed(str(data.error)));
    default: return line(t.unknown(eventType));
  }
}

/** The bot's own message as it appears in the timeline. */
export function renderSelf(ref: string, target: QQOfficialTarget, body: string, timezone: string, t: RenderText): string {
  return `${ref ? `#${ref} ` : ''}[${conversationLabel(target, t)} ${shortTime(timezone)}] ${t.you}: ${body}`;
}
