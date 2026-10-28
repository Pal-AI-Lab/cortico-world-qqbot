import { describe, expect, it } from 'vitest';
import { renderIncoming, renderNotice, renderText } from '../src/render.ts';

const t = renderText('zh');
const face = (text: string) => `<faceType=1,faceId="13",ext="${Buffer.from(JSON.stringify({ text })).toString('base64')}">`;
const base = { t, timezone: 'UTC', ref: '7', refOf: (id: string) => (id === 'known' ? '3' : undefined) };

describe('model-facing message lines', () => {
  it('renders a direct message with faces, a known quote and attachment placeholders', () => {
    const { text } = renderIncoming({
      content: `在吗${face('[呲牙]')}[<face,id=13/>]`, timestamp: '2026-10-27T08:05:00+00:00', author: { user_openid: 'ABCDEF0123456789' },
      message_type: 103, message_reference: { message_id: 'known' }, msg_elements: [{ content: 'old' }],
      attachments: [{ content_type: 'image/png', url: 'u' }, { content_type: 'voice', url: 'v' }, { content_type: 'file', filename: 'a.pdf', url: 'f' }],
    }, { ...base, target: { kind: 'c2c', id: 'ABCDEF0123456789' }, eventType: 'C2C_MESSAGE_CREATE' });
    expect(text).toBe('#7 [私聊 08:05] 用户456789: [回复#3] 在吗 [表情:呲牙] [表情:呲牙] [图片] [语音] [文件 a.pdf]');
  });

  it('quotes an unrecorded message inline and marks group @-messages as addressed to the bot', () => {
    const { text, mentionedSelf } = renderIncoming({
      content: ' 看这个', timestamp: '2026-10-27T08:05:00Z', author: { member_openid: 'MEMBER000111' },
      message_type: 103, msg_elements: [{ content: '原来那句' }],
    }, { ...base, target: { kind: 'group', id: 'GROUP000999' }, eventType: 'GROUP_AT_MESSAGE_CREATE' });
    expect(text).toBe('#7 [群 000999 08:05] 成员000111: [回复「原来那句」] @你 看这个');
    expect(mentionedSelf).toBe(true);
  });

  it('names channel senders and mentions', () => {
    const { text } = renderIncoming({
      content: '<@!bot> 和 <qqbot-at-user id="u2" /> 好', timestamp: '2026-10-27T08:05:00Z', author: { id: 'u1', username: 'Alice' },
      mentions: [{ id: 'bot', username: 'Coo', bot: true }, { id: 'u2', username: 'Bob' }],
    }, { ...base, target: { kind: 'channel', id: 'CHANNEL42' }, eventType: 'AT_MESSAGE_CREATE', selfId: 'bot' });
    expect(text).toBe('#7 [频道 NNEL42 08:05] Alice: @你 和 @Bob 好');
  });

  it('renders relationship notices as one line', () => {
    expect(renderNotice('C2C_MSG_REJECT', { openid: 'ABCDEF0123456789' }, { kind: 'c2c', id: 'ABCDEF0123456789' }, t))
      .toBe('[系统] 私聊 用户456789 关闭了你的主动消息');
  });
});
