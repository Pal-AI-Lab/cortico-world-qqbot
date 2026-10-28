import type { QQOfficialTargetKind } from './protocol.ts';

export type ModelLanguage = 'zh' | 'en';

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

export const QQOFFICIAL_MODEL_TEXT = {
  zh: {
    environment: `你连接着一个 QQ 机器人入口，经它在 QQ 上收发消息。对方在 QQ 里看到的是这个机器人账号。

每条消息一行:\`#编号 [会话 时间] 发言人: 正文\`。私聊和群聊里 QQ 通常只给对方的 OpenID,行里写的是它的尾号;对方告诉你名字时记下来。[图片] 随消息附上图片，[语音] 在你能听音频时附上录音，下载慢的稍后单独送到;[视频]、[文件] 只是占位，要内容就按编号读取附件。[回复#编号] 指被引用的那条。
发消息时用 to 填会话地址(见下面的会话列表),或者用 reply_to 填一条消息的编号，会话随之确定。

QQ 对这个入口的限制，以及怎么应对:
- 私聊：对方每发一条消息，你在 30 分钟内最多回复 4 次。想说的话合并成一两条发，不要拆成很多条短句;表情包和文字放在同一条里。
- 群里：只收得到 @你 的消息，群主打开「获取全部消息」后才看得到别的消息;一条消息之后 5 分钟内最多回复 5 次。被 @ 就尽快回。
- 超出回复范围的消息算主动消息。主动消息额度少，对方也可以关闭接收，留给提醒和确实需要你先开口的时候。对方关闭了接收，就等对方先说话。
- 主动消息被拒时会改发召回消息。召回只在私聊有：对方最后一次找你之后的 30 天分成当天、1–3 天、3–7 天、7–30 天四段，每段只能发 1 条，只用在重要的提醒上。
- 发出超过 2 分钟的消息撤回不了。
- 这个机器人账号只能被拉进创建者当群主或管理员的群;别人要私聊它，得由创建者在 QQ 开放平台加成体验用户。有人问起就照实说。
- 每次发送的回执写明这条按被动回复、主动消息还是召回发出，以及还剩几次、还剩多久;碰到限制时，回执写出是哪一条。

表情包:QQ 这边没有小黄脸、戳一戳和贴表情可发，表情包只能当图片发。在你的记忆里给表情包单独留一个地方，看到好用的表情图就收进来;收的时候在能起名的地方(文件名、标题或备注)写清画面内容和适合的场合。聊天时积极配表情包：先去那里挑一张，和文字放在同一条消息里发。

发图片用你见过的 log: 句柄、收藏的 mem: 句柄或公网 URL,不能用本机路径。语音条要单独一条发，本机装了 FFmpeg 才能转码。
要让私聊回复在 QQ 里逐字出现，先开启流式回复，再在下一轮直接写给对方的话，不要再另外发送同一段话。
发送超时或服务端出错时结果未知，不要直接重发。`,
    conversations: '下面是你正在参与的会话:',
    noConversations: '还没有人在 QQ 上跟你说过话。',
    identity: (name: string) => `这个机器人账号在 QQ 上的名字是「${name}」。`,
    send: '发一条 QQ 消息：文字，可以带一张图片或表情包(image),或者单独发一条语音(voice)。reply_to 填消息编号，回复那一条，会话随之确定;quote=true 时在 QQ 里显示引用。不填 reply_to 时自动回复这个会话里还能回复的最近一条，没有就按主动消息发送;delivery=proactive 强制主动消息。',
    media: '发视频、文件，或一次发多张图片(items,最多 8 项)。url 与 blob(log:/mem: 句柄)二选一;fileType:1 图片、2 视频、3 语音、4 文件。每一项各算一条消息，部分失败时已发出的不会重发。',
    stream: 'followModel=true:下一轮你写的公开正文会自动发到这个会话，私聊里逐字显示，其他会话在本轮结束后整段发出。手动分片时传 text,续片沿用返回的 streamId,finish 默认 true。',
    remove: '撤回你发过的一条消息，填它的编号。发出超过 2 分钟的撤回不了。',
    history: '读 QQ 会话的历史消息，可按会话(to)筛选，before 填编号往前翻。',
    read: '读取一条消息里的附件(语音转成 WAV)。message 填消息编号;index 是第几个附件，默认第 1 个;quoted=true 读它引用的那条消息里的附件。',
    targets: '列出认识的 QQ 会话、地址，以及现在还能不能被动回复。定时提醒里记下准确地址，到点后用 delivery=proactive 发送。',
    interaction: '确认按钮互动:code=0 成功、1 失败、2 太频繁、3 重复、4 无权限、5 仅管理员可操作。',
    rule: (kind: QQOfficialTargetKind) => kind === 'c2c' ? '私聊里对方每发一条消息，30 分钟内最多回复 4 次' : '群和频道里一条消息之后 5 分钟内最多回复 5 次',
    replyLeft: (left: number, msLeft: number) => msLeft <= 0 ? '已过这条消息的回复时限' : left > 0 ? `这条消息还能回 ${left} 次，还剩 ${minutes(msLeft)} 分钟` : '这条消息的回复次数已用完',
    sep: '。', comma: '，',
    replyUsedUp: (rule: string) => `之后再发就是主动消息(${rule})`,
    proactive: (rule: string) => `现在没有还能回复的消息(${rule}),这条按主动消息发出，对方可以关闭接收`,
    wakeup: '这一段时间的召回已用掉(对方最后一次找你后的 30 天分四段，每段 1 条)',
    viaWakeup: '主动消息被拒，改发了召回消息',
    noReplyLeft: (kind: QQOfficialTargetKind) => `没有还能回复的消息(${kind === 'c2c' ? '私聊里对方每发一条消息，30 分钟内最多回复 4 次' : '群和频道里一条消息之后 5 分钟内最多回复 5 次'});要发就按主动消息发，或者等对方先开口`,
    explain: {
      40034128: '回复时限或次数已用完',
      40034100: '主动消息发得太频繁，过一会儿再发',
      40034105: '没有发主动消息的权限;私聊可以等对方先开口，群里要群主打开机器人主动发言',
      40054013: '对方关闭了主动消息，等对方先开口',
      40034122: '这一段时间的召回已用掉(对方最后一次找你后的 30 天分四段，每段 1 条),等对方先开口',
      40034123: '这个会话不支持召回消息',
      40034006: '内容没通过 QQ 审核，换个说法',
      40054016: '机器人账号已下线',
    } as Record<number, string>,
    sendFailed: '[send failed]',
    toolFailed: '[tool failed]',
    attempt: '准备发送',
    removed: '已撤回',
    acknowledged: '已确认互动',
    canReply: '可以被动回复',
    noReply: '只能发主动消息',
    proactiveBlocked: '对方关闭了主动消息',
    attachment: (n: number) => `第 ${n} 个附件`,
    noHistory: '(没有记录)',
    lateAttachment: (ref: string) => `[#${ref} 的附件]`,
    batchFailed: (n: number, error: string) => `[send failed] 第 ${n} 项:${error}。前面已发出的不要重发。`,
  },
  en: {
    environment: `You are connected to a QQ bot entry and send and receive QQ messages through it. People on QQ see this bot account.

Each message is one line: \`#n [conversation HH:MM] sender: text\`. In direct and group chats QQ usually gives only the sender's OpenID; the line shows its tail. When someone tells you their name, remember it. [image] comes with the picture attached and [voice] with the recording when you can take audio; slow downloads arrive shortly after on their own. [video] and [file] are placeholders: read the attachment by its message number when you need it. [reply to #n] points at the quoted message.
Address a message with to (see the conversation list below), or give a message number in reply_to and its conversation is used.

QQ's limits on this entry, and how to work with them:
- Direct chats: for each message the other person sends, you can reply up to 4 times within 30 minutes. Put what you want to say into one or two messages instead of many short ones; send a sticker in the same message as the text.
- Groups: you only receive messages that @ you, unless the group owner turns on "receive all messages"; you can reply up to 5 times within 5 minutes of a message. Reply soon when you are @-ed.
- A message outside those limits is a proactive message. Proactive quota is small and the recipient can turn proactive messages off; keep them for reminders and for when you truly need to speak first. If the recipient turned them off, wait for them to speak.
- When a proactive message is refused, a wakeup message is sent instead. Wakeup messages exist only in direct chats: the 30 days after the person last contacted you are split into the same day, days 1–3, 3–7 and 7–30, with one wakeup message each. Use them only for important reminders.
- Messages older than 2 minutes cannot be recalled.
- This bot account can only join groups its creator owns or manages; anyone else who wants to message it directly must be added as a test user by the creator on the QQ open platform. Say so if asked.
- Every send receipt says whether the message went out as a reply, a proactive message or a wakeup message, and how many replies and how much time remain; when a limit is hit, the receipt names it.

Stickers: QQ offers no faces, pokes or reactions to send here, so stickers go out as images. Keep a dedicated place for stickers in your memory and save good sticker images when you see them; when saving, write what the picture shows and when it fits wherever a name can go (file name, title or note). Use stickers freely in chat: pick one from that place and send it in the same message as your text.

Send images from a log: handle you have seen, a mem: handle you kept, or a public URL; local paths are not accepted. A voice bar is a message of its own and needs FFmpeg on this machine.
To make a direct-chat reply appear word by word in QQ, start a streamed reply, then write your words to the recipient in the next round, without sending the same text again.
After a timeout or server error the result is unknown: do not resend blindly.`,
    conversations: 'Your conversations:',
    noConversations: 'Nobody has talked to you on QQ yet.',
    identity: (name: string) => `This bot account's QQ name is "${name}".`,
    send: 'Send a QQ message: text, optionally with one image or sticker (image), or a voice bar on its own (voice). reply_to takes a message number, replies to it and uses its conversation; quote=true shows the quote in QQ. Without reply_to it replies to the latest message in the conversation that still accepts a reply, otherwise it is sent proactively; delivery=proactive forces a proactive message.',
    media: 'Send video, files, or several images at once (items, up to 8). Give exactly one of url or blob (log:/mem: handle); fileType: 1 image, 2 video, 3 voice, 4 file. Each item counts as one message; after a partial failure, items already sent are not resent.',
    stream: 'followModel=true: your public text in the next round goes to this conversation automatically, word by word in direct chats and as one message at round end elsewhere. For manual parts pass text, reuse the returned streamId; finish defaults to true.',
    remove: 'Recall one of your messages by its number. Messages older than 2 minutes cannot be recalled.',
    history: 'Read past QQ messages, optionally for one conversation (to); before takes a message number to page back.',
    read: 'Read an attachment of a message (voice becomes WAV). message is the message number; index is which attachment, 1 by default; quoted=true reads from the message it quotes.',
    targets: 'List known QQ conversations, their addresses and whether a reply is still possible. For a scheduled reminder, keep the exact address and send with delivery=proactive when it fires.',
    interaction: 'Acknowledge a button interaction: code=0 success, 1 failure, 2 too frequent, 3 duplicate, 4 forbidden, 5 administrators only.',
    rule: (kind: QQOfficialTargetKind) => kind === 'c2c' ? 'in a direct chat, up to 4 replies within 30 minutes of each message' : 'in groups and channels, up to 5 replies within 5 minutes of a message',
    replyLeft: (left: number, msLeft: number) => msLeft <= 0 ? 'the reply window for this message has passed' : left > 0 ? `${left} more replies to this message, ${minutes(msLeft)} minutes left` : 'no replies left for this message',
    sep: '. ', comma: ', ',
    replyUsedUp: (rule: string) => `further messages are proactive (${rule})`,
    proactive: (rule: string) => `no message accepts a reply now (${rule}), so this went out as a proactive message; the recipient can turn these off`,
    wakeup: 'the wakeup message for this period is used (the 30 days after they last contacted you have four periods, one each)',
    viaWakeup: 'the proactive message was refused, so a wakeup message was sent',
    noReplyLeft: (kind: QQOfficialTargetKind) => `no message accepts a reply now (${kind === 'c2c' ? 'in a direct chat, up to 4 replies within 30 minutes of each message' : 'in groups and channels, up to 5 replies within 5 minutes of a message'}); send a proactive message or wait for them to speak`,
    explain: {
      40034128: 'the reply window or reply count is used up',
      40034100: 'proactive messages are too frequent; wait a little',
      40034105: 'no permission for proactive messages; in a direct chat wait for them to speak, in a group the owner must allow the bot to speak first',
      40054013: 'the recipient turned proactive messages off; wait for them to speak',
      40034122: 'the wakeup message for this period is used (the 30 days after they last contacted you have four periods, one each); wait for them to speak',
      40034123: 'this conversation does not support wakeup messages',
      40034006: 'QQ moderation rejected the content; say it differently',
      40054016: 'the bot account is offline',
    } as Record<number, string>,
    sendFailed: '[send failed]',
    toolFailed: '[tool failed]',
    attempt: 'send prepared',
    removed: 'recalled',
    acknowledged: 'interaction acknowledged',
    canReply: 'reply possible',
    noReply: 'proactive only',
    proactiveBlocked: 'proactive messages turned off',
    attachment: (n: number) => `attachment ${n}`,
    noHistory: '(no records)',
    lateAttachment: (ref: string) => `[attachment of #${ref}]`,
    batchFailed: (n: number, error: string) => `[send failed] item ${n}: ${error}. Do not resend the items already sent.`,
  },
};
