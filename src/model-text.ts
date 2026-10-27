export type ModelLanguage = 'zh' | 'en';

export const QQOFFICIAL_MODEL_TEXT = {
  zh: {
    environment: `你在 QQ 上，通过 QQ 官方机器人接口收发消息。

每条消息一行:\`#编号 [会话 时间] 发言人: 正文\`。私聊和群聊里 QQ 只给对方 OpenID,行里写的是它的尾号，通常没有昵称。[图片] 随消息附上图片，[语音] 在你能听音频时附上录音，下载慢的稍后单独送到;[视频]、[文件] 只是占位，要内容就按编号读取附件。[回复#编号] 指被引用的那条。
发消息时用 to 填会话地址(见下面的会话列表),或者用 reply_to 填一条消息的编号，会话随之确定。
QQ 只允许回复用户刚发来的消息：私聊里一条消息 30 分钟内最多回复 4 次，群里 5 分钟内最多 5 次。超出这个范围只能发主动消息，额度很少，对方也可能关闭了接收。回执会写明这条是被动回复还是主动消息。
发图片或语音用你见过的 log: 句柄、收藏的 mem: 句柄或公网 URL,不能用本机路径;语音会自动转码。
要让回复在 QQ 里逐字出现，先开启流式回复，再在下一轮直接写给对方的话，不要再另外发送同一段话。
发送超时或服务端出错时结果未知，不要直接重发。`,
    conversations: '下面是你正在参与的会话:',
    noConversations: '还没有人在 QQ 上跟你说过话。',
    identity: (name: string) => `你在 QQ 上的名字是「${name}」。`,
    send: '发一条 QQ 消息：文字，可以带一张图片(image),或者单独发一条语音(voice)。reply_to 填消息编号，回复那一条，会话随之确定;quote=true 时在 QQ 里显示引用。不填 reply_to 时自动回复这个会话里还能回复的最近一条，没有就按主动消息发送;delivery=proactive 强制主动消息。',
    media: '发视频、文件，或一次发多张图片(items,最多 8 项)。url 与 blob(log:/mem: 句柄)二选一;fileType:1 图片、2 视频、3 语音、4 文件。部分失败时已发出的不会重发。',
    stream: 'followModel=true:下一轮你写的公开正文会自动发到这个会话，私聊里逐字显示，其他会话在本轮结束后整段发出。手动分片时传 text,续片沿用返回的 streamId,finish 默认 true。',
    remove: '撤回你发过的一条消息，填它的编号。',
    history: '读 QQ 会话的历史消息，可按会话(to)筛选，before 填编号往前翻。',
    read: '读取一条消息里的附件(语音转成 WAV)。message 填消息编号;index 是第几个附件，默认第 1 个;quoted=true 读它引用的那条消息里的附件。',
    targets: '列出认识的 QQ 会话、地址，以及现在还能不能被动回复。定时提醒里记下准确地址，到点后用 delivery=proactive 发送。',
    interaction: '确认按钮互动:code=0 成功、1 失败、2 太频繁、3 重复、4 无权限、5 仅管理员可操作。',
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
    environment: `You are on QQ, sending and receiving through the QQ official bot API.

Each message is one line: \`#n [conversation HH:MM] sender: text\`. In direct and group chats QQ gives only the sender's OpenID; the line shows its tail, usually without a nickname. [image] comes with the picture attached and [voice] with the recording when you can take audio; slow downloads arrive shortly after on their own. [video] and [file] are placeholders: read the attachment by its message number when you need it. [reply to #n] points at the quoted message.
Address a message with to (see the conversation list below), or give a message number in reply_to and its conversation is used.
QQ only allows replies to messages users just sent: in a direct chat up to 4 replies within 30 minutes of a message, in a group up to 5 within 5 minutes. Outside that, only proactive messages remain; their quota is small and the recipient may have turned them off. The receipt says whether a message went out as a reply or a proactive message.
Send images or voice from a log: handle you have seen, a mem: handle you kept, or a public URL; local paths are not accepted. Voice is converted automatically.
To make a reply appear word by word in QQ, start a streamed reply, then write your words to the recipient in the next round, without sending the same text again.
After a timeout or server error the result is unknown: do not resend blindly.`,
    conversations: 'Your conversations:',
    noConversations: 'Nobody has talked to you on QQ yet.',
    identity: (name: string) => `Your QQ name is "${name}".`,
    send: 'Send a QQ message: text, optionally with one image (image), or a voice bar on its own (voice). reply_to takes a message number, replies to it and uses its conversation; quote=true shows the quote in QQ. Without reply_to it replies to the latest message in the conversation that still accepts a reply, otherwise it is sent proactively; delivery=proactive forces a proactive message.',
    media: 'Send video, files, or several images at once (items, up to 8). Give exactly one of url or blob (log:/mem: handle); fileType: 1 image, 2 video, 3 voice, 4 file. After a partial failure, items already sent are not resent.',
    stream: 'followModel=true: your public text in the next round goes to this conversation automatically, word by word in direct chats and as one message at round end elsewhere. For manual parts pass text, reuse the returned streamId; finish defaults to true.',
    remove: 'Recall one of your messages by its number.',
    history: 'Read past QQ messages, optionally for one conversation (to); before takes a message number to page back.',
    read: 'Read an attachment of a message (voice becomes WAV). message is the message number; index is which attachment, 1 by default; quoted=true reads from the message it quotes.',
    targets: 'List known QQ conversations, their addresses and whether a reply is still possible. For a scheduled reminder, keep the exact address and send with delivery=proactive when it fires.',
    interaction: 'Acknowledge a button interaction: code=0 success, 1 failure, 2 too frequent, 3 duplicate, 4 forbidden, 5 administrators only.',
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
