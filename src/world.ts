import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
import type { Language } from 'cortico/core/language.ts';
import type { BlobInput, EventEnvelope, OutputTap, ToolDef, ToolOutcome, World, WorldWebUiDecl, WorldHost } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import type { WorldContext } from 'cortico/world.ts';
import { coerceGroupValues, getByPath, setByPath } from 'cortico/core/config-schema.ts';
import { QQOfficialBinding } from './binding.ts';
import { QQOfficialApiError, QQOfficialClient, QQOFFICIAL_SANDBOX_URL } from './client.ts';
import { QQOFFICIAL_ID, QQOFFICIAL_SECRET, qqOfficialConfigGroup, validateConfig, type QQOfficialConfigSection } from './config.ts';
import { QQOfficialGateway, type QQOfficialConnectionState } from './gateway.ts';
import { QQOFFICIAL_MODEL_TEXT, type ModelLanguage } from './model-text.ts';
import { readAttachment } from './media.ts';
import { normalize } from './normalize.ts';
import { integer, object, remoteUrl, route, string, target, targetKey, type JsonObject, type QQOfficialDispatch, type QQOfficialTarget } from './protocol.ts';
import { qqOfficialText } from './strings.ts';
import { qqOfficialTools, type QQOfficialAction } from './tools.ts';
import { QQOfficialWebhook } from './webhook.ts';
import { audioToSilk, audioToWav, isAudio, isSilk } from './audio.ts';
import { mediaBlobHandle, publicMedia } from './media-source.ts';
import { QQUploader, MEDIA_LIMITS } from './upload.ts';
import { QQSessionState } from './session-state.ts';
import { sendWithFallback, waitUntil } from './delivery.ts';
import { QQReplyStream } from './reply-stream.ts';
import { address, attachmentsOf, conversationLabel, shortId, renderIncoming, renderNotice, renderSelf, renderText, type RenderText } from './render.ts';

/** How long a message waits for its images before they follow as a separate event; matches the built-in QQ World. */
const INLINE_WAIT_MS = 2500;

/** A local reference shown as `#ref` on message lines; QQ message ids are too long to repeat in context. */
interface MessageRef { target: QQOfficialTarget; messageId: string; cursor: number }

/** What a successful send returns before it is rendered for the model. */
interface SentResult { receipt: JsonObject }

interface StreamState {
  target: QQOfficialTarget; streamId: string; format: string; anchors: JsonObject; sequence: number; index: number; at: number; uncertain?: boolean;
}

export interface QQOfficialWorldOptions {
  context: WorldContext<QQOfficialConfigSection>;
  modelLanguage?: () => ModelLanguage;
  /** Endpoint overrides for local protocol servers in tests. */
  endpoints?: { apiUrl?: string; tokenUrl?: string; bindingUrl?: string; mediaOrigin?: string };
}

/** QQ owns delivery semantics; Core owns event storage, batching and the Persona's decision to act. */
export class QQOfficialWorld implements World {
  readonly id = QQOFFICIAL_ID;
  private host: WorldHost | null = null;
  private client: QQOfficialClient | null = null;
  private gateway: QQOfficialGateway | null = null;
  private webhook: QQOfficialWebhook | null = null;
  private abort = new AbortController();
  private incoming = Promise.resolve();
  private outgoing = Promise.resolve<unknown>(undefined);
  private control = Promise.resolve<unknown>(undefined);
  private seen = new Set<string>();
  private appId = '';
  private state: QQOfficialConnectionState = 'offline';
  private detail = '';
  private binding: QQOfficialBinding;
  private sessions = new QQSessionState();
  private uploader: QQUploader | null = null;
  private streams = new Map<string, StreamState>();
  private streamTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private replyStream?: QQReplyStream;
  private replyTarget?: QQOfficialTarget;
  private replyCursor = 0;
  private modelRoundOpen = false;
  private replyWaitForRound = false;
  private lastProactiveAt = 0;
  private refs = new Map<string, MessageRef>();
  private refByMessage = new Map<string, string>();
  private nextRef = 1;
  private self?: { id: string; name: string };

  constructor(private readonly options: QQOfficialWorldOptions) {
    this.binding = new QQOfficialBinding(options.context.cfg.timeoutMs, options.endpoints?.bindingUrl);
  }

  private get cfg() { return this.options.context.cfg; }
  private get language(): ModelLanguage { return this.options.modelLanguage?.() ?? this.cfg.modelLanguage; }
  private get text() { return QQOFFICIAL_MODEL_TEXT[this.language]; }
  private get view(): RenderText { return renderText(this.language); }

  /** Conversations keep first-seen order so the system prefix only changes when a new one appears. */
  envPromptVars(): Record<string, string> {
    const lines = [...this.sessions.targets.values()].map(s => `- ${this.describeTarget(s.target, s.label)}(${address(s.target)})`);
    return {
      'qqofficial.environment': this.text.environment,
      'qqofficial.conversations': lines.length ? `${this.text.conversations}\n${lines.join('\n')}` : this.text.noConversations,
      'qqofficial.identity': this.self?.name ? this.text.identity(this.self.name) : '',
    };
  }

  private describeTarget(target: QQOfficialTarget, label?: string): string {
    const t = this.view;
    const where = conversationLabel(target, t);
    if (label) return `${where} ${label}`;
    return target.kind === 'c2c' ? `${where} ${t.user(shortId(target.id))}` : where;
  }

  tools(): ToolDef[] {
    return qqOfficialTools(this.language, (action, args, signal) => this.enqueue(async () => {
      const internal = this.fromModel(action, args);
      // An image or voice bar given to the send tool goes through the media path.
      const run = internal.mediaSend ? 'media' : action;
      delete internal.mediaSend;
      return this.present(run, await this.execute(run, internal, signal));
    }));
  }

  /** Model-facing arguments follow Cortico's QQ World: `to` addresses, `#ref` message references and `text`. */
  private fromModel(action: QQOfficialAction, args: JsonObject): JsonObject {
    const out: JsonObject = { ...args };
    delete out.to; delete out.reply_to; delete out.text; delete out.image; delete out.voice; delete out.message; delete out.quoted; delete out.before; delete out.quote;
    if (Array.isArray(args.items)) out.items = args.items.map(item => {
      const { text, ...rest } = object(item);
      return text === undefined ? rest : { ...rest, content: text };
    });
    const reference = (value: unknown): MessageRef | { messageId: string } => {
      const raw = string(value, 'message reference').trim().replace(/^#/, '');
      return this.refs.get(raw) ?? { messageId: raw };
    };
    let destination = args.to !== undefined ? this.parseAddress(args.to) : undefined;
    if (args.reply_to !== undefined && args.reply_to !== '') {
      const ref = reference(args.reply_to);
      if ('target' in ref) {
        if (destination && targetKey(destination) !== targetKey(ref.target)) throw new Error(`#${String(args.reply_to).replace(/^#/, '')} is not in ${address(destination)}`);
        destination ??= ref.target;
      }
      out.replyTo = ref.messageId;
      if (args.quote === true) out.referenceId = ref.messageId;
    }
    if (args.text !== undefined) out.content = args.text;
    if (action === 'send' && (args.image !== undefined || args.voice !== undefined)) {
      if (args.image !== undefined && args.voice !== undefined) throw new Error('Send an image or a voice bar, not both');
      const source = string(args.image ?? args.voice, args.image !== undefined ? 'image' : 'voice').trim();
      Object.assign(out, /^(log|mem):/.test(source) ? { blob: source } : { url: source }, { fileType: args.image !== undefined ? 1 : 3, mediaSend: true });
    }
    if (action === 'remove' || action === 'read') {
      const ref = reference(args.message);
      if ('target' in ref) { destination ??= ref.target; if (action === 'read') out.cursor = ref.cursor; }
      else if (action === 'read') throw new Error(`No recorded QQ message #${String(args.message).replace(/^#/, '')}`);
      out.messageId = ref.messageId;
      if (action === 'read') {
        out.index = args.index === undefined ? 0 : integer(args.index, 'index', 1, 100) - 1;
        if (args.quoted === true) out.quotedIndex = 0;
      }
    }
    if (action === 'history' && args.before !== undefined) {
      const ref = reference(args.before);
      if (!('target' in ref)) throw new Error(`No recorded QQ message #${String(args.before).replace(/^#/, '')}`);
      out.beforeCursor = ref.cursor;
    }
    if (destination) out.target = destination;
    else if (!['history', 'targets', 'interaction', 'read'].includes(action)) {
      throw new Error('Specify a recipient with to, or quote a recorded message with reply_to');
    }
    return out;
  }

  /** Accepts `kind:id`; the object form is what earlier versions told the model to store in reminders. */
  private parseAddress(value: unknown): QQOfficialTarget {
    if (value && typeof value === 'object') return target(value);
    const match = /^(c2c|group|channel|dms):(.+)$/.exec(string(value, 'to').trim());
    if (!match) throw new Error(`"${String(value)}" is not a QQ address; use c2c:<OpenID>, group:<group OpenID>, channel:<id> or dms:<id>`);
    return { kind: match[1] as QQOfficialTarget['kind'], id: match[2] };
  }

  /** Renders tool results as short lines; JSON stays in the event archive. */
  private present(action: QQOfficialAction, result: string | ToolOutcome | SentResult | SentResult[]): string | ToolOutcome {
    if (Array.isArray(result)) return result.map(r => this.receiptLine(r.receipt)).join('\n');
    if (typeof result === 'object' && 'receipt' in result) {
      if (action === 'stream' && result.receipt.finish === false) return `${this.receiptLine(result.receipt)} streamId=${String(result.receipt.streamId)}`;
      return this.receiptLine(result.receipt);
    }
    return result;
  }

  private receiptLine(receipt: JsonObject): string {
    const t = this.view;
    const destination = receipt.target as QQOfficialTarget;
    const ref = typeof receipt.messageId === 'string' ? this.refByMessage.get(receipt.messageId) : undefined;
    const mode = receipt.is_wakeup ? 'wakeup' : receipt.msg_id || receipt.event_id ? 'reply' : 'proactive';
    const notes = [t.modes[mode], ...((receipt.fallbacks as string[] | undefined) ?? []).map(f => t.fallback[f]).filter(Boolean)];
    return `[sent${ref ? ` #${ref}` : ''} → ${this.describeTarget(destination, this.sessions.targets.get(targetKey(destination))?.label)}, ${notes.join(', ')}]`;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.outgoing.then(operation);
    this.outgoing = task.catch(() => undefined);
    return task;
  }

  outputTap(): OutputTap | undefined {
    if (!this.host) return undefined;
    // Return a stable forwarding tap: the host may acquire it before the tool arms a reply.
    return {
      onEvent: event => {
        if (event.type === 'response.created') { this.modelRoundOpen = true; this.replyWaitForRound = false; }
        if (!this.replyWaitForRound && this.replyRouteValid()) this.replyStream?.tap.onEvent(event);
      },
      externalizes: event => !this.replyWaitForRound && this.replyRouteValid() && (this.replyStream?.tap.externalizes?.(event) ?? false),
      onRoundEnd: () => { this.modelRoundOpen = false; if (!this.replyWaitForRound) this.replyStream?.tap.onRoundEnd?.(); },
      onAbort: reason => { this.modelRoundOpen = false; this.replyStream?.tap.onAbort?.(reason); },
    };
  }

  private replyRouteValid(): boolean {
    if (!this.host || !this.replyTarget || !this.replyStream || this.replyStream.closed) return false;
    const latest = this.host.store.latestCursor();
    if (latest > this.replyCursor) {
      const incoming = this.host.store.range({ fromCursor: this.replyCursor + 1 });
      this.replyCursor = latest;
      if (incoming.some(e => e.origin === 'external' && (e.source !== this.id || (e.type === `${this.id}.message`
        && targetKey(e.meta!.target as QQOfficialTarget) !== targetKey(this.replyTarget!))))) {
        // A shared Core session may receive another conversation before the next round starts.
        // Close only text already selected for this reply; never route the new conversation to QQ.
        void this.replyStream.finish(); return false;
      }
    }
    return true;
  }

  onTurnEnded(): void { void this.finishStreams(); }
  onHandoffEnded(): void { void this.finishStreams(); }

  private async finishStreams(): Promise<void> {
    await this.replyStream?.finish();
    await Promise.allSettled([...this.streams.values()].filter(s => !s.uncertain).map(s =>
      this.enqueue(() => this.execute('stream', { target: s.target, streamId: s.streamId, content: '', finish: true }))));
  }

  async start(host: WorldHost): Promise<void> {
    validateConfig(this.cfg);
    this.appId = string(this.cfg.appId, 'AppID');
    const secret = string(this.options.context.secret(QQOFFICIAL_SECRET), 'AppSecret');
    this.host = host;
    this.abort = new AbortController();
    const saved = host.store.range({ source: this.id });
    this.sessions = new QQSessionState(); this.streams.clear(); this.lastProactiveAt = 0;
    this.refs.clear(); this.refByMessage.clear(); this.nextRef = 1;
    for (const event of saved) {
      if (event.meta?.appId !== this.appId) continue;
      this.sessions.observe(event);
      if (typeof event.meta.ref === 'string') this.remember(event.meta.ref, event.meta.target as QQOfficialTarget, String(event.meta.messageId), event.cursor);
      if (event.type === `${this.id}.attempt` && event.meta.streamId) {
        const state = this.streams.get(this.streamKey(event.meta.target as QQOfficialTarget, String(event.meta.streamId)));
        if (state) state.uncertain = true;
      }
      if (event.type === `${this.id}.notice` && event.meta.eventType === 'STREAM_PART_REJECTED') {
        const state = this.streams.get(this.streamKey(event.meta.target as QQOfficialTarget, String(event.meta.streamId)));
        if (state) state.uncertain = false;
      }
      if (event.type === `${this.id}.sent`) {
        if (!event.meta.msg_id && !event.meta.event_id) this.lastProactiveAt = Math.max(this.lastProactiveAt, Date.parse(event.ts));
        this.rememberStream(event.meta, Date.parse(event.ts));
      }
    }
    this.seen = new Set(saved.slice(-10000)
      .filter((e) => e.meta?.appId === this.appId && typeof e.meta?.dedupKey === 'string').map((e) => e.meta!.dedupKey as string));
    this.client = new QQOfficialClient({
      appId: this.appId, secret, timeoutMs: this.cfg.timeoutMs, signal: this.abort.signal,
      apiUrl: this.options.endpoints?.apiUrl ?? (this.cfg.sandbox ? QQOFFICIAL_SANDBOX_URL : undefined),
      tokenUrl: this.options.endpoints?.tokenUrl,
    });
    this.uploader = new QQUploader(this.client, this.cfg.timeoutMs, this.options.endpoints?.mediaOrigin);
    for (const state of this.streams.values()) this.watchStream(state);
    try {
      if (this.cfg.transport === 'websocket') {
        this.gateway = new QQOfficialGateway({
          client: this.client, intents: this.cfg.intents, reconnectMs: this.cfg.reconnectMs,
          maxReconnectMs: this.cfg.maxReconnectMs, timeoutMs: this.cfg.timeoutMs,
          onEvent: (event) => this.receive(event), onState: (state, detail) => this.setState(state, detail),
          onReady: (user) => { if (typeof user.id === 'string') this.self = { id: user.id, name: typeof user.username === 'string' ? user.username : '' }; },
        });
        this.gateway.start();
      } else {
        this.webhook = new QQOfficialWebhook({
          secret, ...this.cfg.webhook, onEvent: (event) => this.receive(event),
          onError: () => this.setState('error', 'Webhook delivery failed'),
        });
        const port = await this.webhook.start();
        this.setState('online', `${this.cfg.webhook.host}:${port}${this.cfg.webhook.path}`);
      }
    } catch (error) { await this.stop(); throw error; }
  }

  async stop(): Promise<void> {
    // Give already-published streams a bounded opportunity to send DONE before aborting the transport.
    if (this.streams.size || this.replyStream) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([this.finishStreams(), new Promise<void>(resolve => { timer = setTimeout(resolve, 2000); })]);
      clearTimeout(timer);
    }
    this.replyStream?.cancel(); this.replyStream = undefined;
    this.modelRoundOpen = false; this.replyWaitForRound = false;
    for (const timer of this.streamTimers.values()) clearTimeout(timer);
    this.streamTimers.clear();
    this.abort.abort();
    await Promise.allSettled([this.gateway?.stop(), this.webhook?.stop()]);
    await Promise.allSettled([this.incoming, this.outgoing]);
    this.gateway = null; this.webhook = null; this.client = null; this.uploader = null; this.host = null;
    this.binding.clear(); this.setState('offline');
  }

  private setState(state: QQOfficialConnectionState, detail = ''): void {
    if (state === this.state && detail === this.detail) return;
    this.state = state; this.detail = detail;
    this.host?.log.info('qqofficial.connection', { state, detail });
  }

  private receive(event: QQOfficialDispatch): Promise<void> {
    const task = this.incoming.then(async () => {
      this.abort.signal.throwIfAborted();
      const incoming = normalize(event);
      if (incoming.key && this.seen.has(incoming.key)) return;
      const { key, ...data } = incoming;
      const extra: JsonObject = key ? { dedupKey: key } : {};
      let text: string;
      if (incoming.kind === 'message') {
        extra.ref = String(this.nextRef);
        text = renderIncoming(incoming.data, { t: this.view, timezone: this.options.context.timezone, ref: extra.ref as string,
          target: incoming.target!, eventType: incoming.eventType, selfId: this.self?.id, refOf: id => this.refByMessage.get(id) }).text;
      } else text = renderNotice(incoming.eventType, incoming.data, incoming.target, this.view);
      const media = incoming.kind === 'message' ? await this.inlineMedia(incoming.data) : { ready: [], late: [] };
      const saved = await this.push(incoming.kind, incoming.target, data, true, extra, text, media.ready);
      if (incoming.kind === 'message') this.remember(extra.ref as string, incoming.target!, incoming.messageId!, saved.cursor);
      for (const pending of media.late) {
        void pending.then(blob => blob && this.push('attachment', incoming.target, { messageId: incoming.messageId }, true,
          { ref: extra.ref }, this.text.lateAttachment(String(extra.ref)), [blob]))
          .catch(error => this.host?.log.warn('qqofficial.attachment.push_failed', { error: String(error) }));
      }
      if (key) {
        this.seen.add(key);
        if (this.seen.size > 10000) this.seen.delete(this.seen.values().next().value!);
      }
    });
    this.incoming = task.catch(() => undefined);
    return task;
  }

  private sender(value?: QQOfficialTarget): string { return value ? `${this.id}.${targetKey(value)}` : this.id; }

  private async push(kind: 'message' | 'notice' | 'attachment' | 'sent' | 'attempt' | 'removed' | 'acknowledged', destination: QQOfficialTarget | undefined,
    data: JsonObject, deliver = false, extra: JsonObject = {}, text?: string, blobs: BlobInput[] = []): Promise<EventEnvelope> {
    if (!this.host) throw new Error('World is not running');
    const event = await this.host.pushEvent({
      type: `${this.id}.${kind}`, source: this.id, origin: 'external', ts: nowIso(this.options.context.timezone),
      senderKey: this.sender(destination), ...(kind === 'sent' ? { tags: ['speak'] as const } : {}),
      text: text ?? this.recordLine(kind, destination, data),
      meta: { ...data, ...extra, target: destination, appId: this.appId },
      ...(blobs.length ? { blobs } : {}),
    }, { deliver, trigger: 'debounce' });
    this.sessions.observe(event);
    return event;
  }

  /**
   * Images (and voice, when the model takes audio and QQ gave no transcript) are fetched from the QQ CDN
   * as the message arrives. What is ready within INLINE_WAIT_MS rides on the message; the rest follows
   * as its own event so a slow download never holds the callback.
   */
  private async inlineMedia(data: JsonObject): Promise<{ ready: BlobInput[]; late: Array<Promise<BlobInput | null>> }> {
    const facts = this.host!.modelFacts;
    const wanted = attachmentsOf(data).filter(a => a.url && (a.kind === 'image' ? facts.accepts(a.mime.startsWith('image/') ? a.mime : 'image/png')
      : a.kind === 'voice' && !a.asr && facts.accepts('audio/wav')));
    if (!wanted.length) return { ready: [], late: [] };
    const tasks = wanted.map(async (a): Promise<BlobInput | null> => {
      try {
        const media = await readAttachment(a.url, { maxBytes: this.cfg.maxMediaBytes, timeoutMs: this.cfg.timeoutMs,
          signal: this.abort.signal, testOrigin: this.options.endpoints?.mediaOrigin });
        if (a.kind === 'voice') {
          const wav = await audioToWav(media.bytes, { signal: this.abort.signal, timeoutMs: this.cfg.timeoutMs, ffmpegPath: this.cfg.ffmpegPath });
          return { bytes: Buffer.from(wav), mime: 'audio/wav', name: `voice-${a.index + 1}.wav`, fallbackText: this.view.voice };
        }
        return { bytes: media.bytes, mime: media.mime, ...(a.name ? { name: a.name } : {}), fallbackText: this.view.image };
      } catch (error) {
        this.host?.log.warn('qqofficial.attachment.fetch_failed', { error: String(error) });
        return null;
      }
    });
    const waited = Symbol('waited');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const elapsed = new Promise<typeof waited>(resolve => { timer = setTimeout(() => resolve(waited), INLINE_WAIT_MS); });
    const results = await Promise.all(tasks.map(task => Promise.race([task, elapsed])));
    clearTimeout(timer);
    const ready = results.filter((r): r is BlobInput => r !== waited && r !== null);
    return { ready, late: tasks.filter((_, i) => results[i] === waited) };
  }

  private remember(ref: string, destination: QQOfficialTarget, messageId: string, cursor: number): void {
    this.refs.set(ref, { target: destination, messageId, cursor });
    if (!this.refByMessage.has(messageId)) this.refByMessage.set(messageId, ref);
    this.nextRef = Math.max(this.nextRef, Number(ref) + 1);
  }

  /** Archive-only records the model meets in history: one short line each. */
  private recordLine(kind: string, destination: QQOfficialTarget | undefined, data: JsonObject): string {
    const t = this.view;
    const where = destination ? conversationLabel(destination, t) : '';
    if (kind === 'notice') return renderNotice(String(data.eventType ?? ''), data, destination, t);
    if (kind === 'attempt') return `${t.system} ${this.text.attempt} → ${where} msg_seq=${String(data.msg_seq)}`;
    if (kind === 'removed') {
      const ref = this.refByMessage.get(String(data.messageId));
      return `${t.system} ${this.text.removed} ${ref ? `#${ref}` : String(data.messageId)}`;
    }
    return `${t.system} ${this.text.acknowledged} ${String(data.interactionId)} code=${String(data.code)}`;
  }

  /** The bot's own message line, with a placeholder for media it carried. */
  private sentLine(receipt: JsonObject, ref: string): string {
    const t = this.view;
    const request = (receipt.request ?? {}) as JsonObject;
    const markdown = request.markdown as JsonObject | undefined;
    const text = [request.content, markdown?.content, request.content_raw].find(v => typeof v === 'string' && v.trim()) as string | undefined;
    const media = receipt.fileType === undefined ? '' : ({ 1: t.image, 2: t.video(''), 3: t.voice, 4: t.file(String(receipt.fileName ?? '')) } as Record<number, string>)[Number(receipt.fileType)];
    return renderSelf(ref, receipt.target as QQOfficialTarget, [text?.trim(), media].filter(Boolean).join(' '), this.options.context.timezone, t);
  }

  private anchors(args: JsonObject): JsonObject {
    if (args.replyTo !== undefined && args.eventId !== undefined) throw new Error('replyTo and eventId are mutually exclusive');
    return {
      ...(args.replyTo !== undefined ? { msg_id: string(args.replyTo, 'replyTo') } : {}),
      ...(args.eventId !== undefined ? { event_id: string(args.eventId, 'eventId') } : {}),
    };
  }

  private async prepare(destination: QQOfficialTarget, anchors: JsonObject): Promise<number> {
    const sequence = this.sessions.sequence(destination, anchors) + 1;
    await this.push('attempt', destination, { ...anchors, msg_seq: sequence });
    return sequence;
  }

  private async execute(action: QQOfficialAction, args: JsonObject, signal?: AbortSignal): Promise<string | ToolOutcome | SentResult | SentResult[]> {
    if (!this.host || !this.client) throw new Error('World is not running');
    const combined = AbortSignal.any([this.abort.signal, ...signal ? [signal] : []]);
    combined.throwIfAborted();
    if (action === 'targets') {
      const listed = this.sessions.list(args.limit === undefined ? 30 : integer(args.limit, 'limit', 1, 100));
      if (!listed.length) return this.text.noConversations;
      return listed.map(s => `- ${this.describeTarget(s.target, s.label)}(${address(s.target)}) ${s.replyAvailable ? this.text.canReply : this.text.noReply}${s.proactive === 'blocked' ? `, ${this.text.proactiveBlocked}` : ''}`).join('\n');
    }
    if (action === 'read') {
      const cursor = integer(args.cursor, 'cursor', 1, Number.MAX_SAFE_INTEGER);
      const index = integer(args.index, 'index', 0, Number.MAX_SAFE_INTEGER);
      const event = this.host.store.get(cursor);
      if (event?.type !== `${this.id}.message` || event.source !== this.id || event.meta?.appId !== this.appId) throw new Error('Message event not found');
      let data = object(event.meta.data);
      if (args.quotedIndex !== undefined) {
        const quotedIndex = integer(args.quotedIndex, 'quotedIndex', 0, 100);
        if (!Array.isArray(data.msg_elements) || quotedIndex >= data.msg_elements.length) throw new Error('Quoted message not found');
        data = object(data.msg_elements[quotedIndex]);
      }
      const attachments = data.attachments;
      if (!Array.isArray(attachments) || index >= attachments.length) throw new Error('Attachment not found');
      const attachment = object(attachments[index]);
      const media = await readAttachment(string(attachment.url, 'attachment.url'), {
        maxBytes: this.cfg.maxMediaBytes, timeoutMs: this.cfg.timeoutMs, signal: combined, testOrigin: this.options.endpoints?.mediaOrigin,
      });
      if (isSilk(media.bytes) || isAudio(String(attachment.content_type ?? media.mime), String(attachment.filename ?? ''))) {
        media.bytes = Buffer.from(await audioToWav(media.bytes, { signal: combined, timeoutMs: this.cfg.timeoutMs, ffmpegPath: this.cfg.ffmpegPath }));
        media.mime = 'audio/wav';
      }
      const text = `[#${String(event.meta.ref ?? event.meta.messageId)} ${this.text.attachment(index + 1)} ${media.mime} ${Math.ceil(media.bytes.byteLength / 1024)} KB]`;
      return { text, blobs: [{ ...media, ...(typeof attachment.filename === 'string' ? { name: media.mime === 'audio/wav' ? attachment.filename.replace(/\.[^.]*$/, '') + '.wav' : attachment.filename } : {}), fallbackText: text }] };
    }
    if (action === 'history') {
      const limit = args.limit === undefined ? 30 : integer(args.limit, 'limit', 1, 100);
      const before = args.beforeCursor === undefined ? undefined : integer(args.beforeCursor, 'beforeCursor', 1, Number.MAX_SAFE_INTEGER) - 1;
      const destination = args.target === undefined ? undefined : target(args.target);
      const events = this.host.store.range({ source: this.id, ...(destination ? { senderKey: this.sender(destination) } : {}), toCursor: before });
      const lines = events.filter((e) => e.meta?.appId === this.appId && e.type !== `${this.id}.attempt`).slice(-limit).map(e => e.text);
      return lines.length ? lines.join('\n') : this.text.noHistory;
    }
    if (action === 'interaction') {
      const id = string(args.interactionId, 'interactionId');
      const code = integer(args.code, 'code', 0, 5);
      const result = await this.client.request('PUT', `/interactions/${encodeURIComponent(id)}`, { code }, combined);
      await this.push('acknowledged', undefined, { interactionId: id, code, result });
      return `[${this.text.acknowledged} ${id} code=${code}]`;
    }
    const destination = target(args.target);
    if (action === 'stream' && args.followModel === true) {
      const anchors = this.delivery(destination, args);
      return this.followModel(destination, args, anchors);
    }
    if (action === 'media' && args.items !== undefined) {
      if (!Array.isArray(args.items) || !args.items.length || args.items.length > 8 || ['url', 'blob', 'path', 'fileType'].some(k => args[k] !== undefined)) throw new Error('Supply 1–8 items or one media source');
      const items = args.items.map(item => object(item));
      for (const item of items) this.validateMedia(item);
      const sent: SentResult[] = [];
      for (let index = 0; index < items.length; index++) {
        try { sent.push(await this.execute('media', { ...args, ...items[index], items: undefined }, combined) as SentResult); }
        catch (error) {
          const lines = [...sent.map(r => this.receiptLine(r.receipt)), this.text.batchFailed(index + 1, error instanceof Error ? error.message : String(error))];
          return { failed: true, text: lines.join('\n') };
        }
      }
      return sent;
    }
    if (action === 'remove') {
      const id = string(args.messageId, 'messageId');
      const result = await this.client.request('DELETE', `${route(destination)}/messages/${encodeURIComponent(id)}`, undefined, combined);
      await this.push('removed', destination, { messageId: id, result });
      const ref = this.refByMessage.get(id);
      return `[${this.text.removed} ${ref ? `#${ref}` : id}]`;
    }
    let anchors = this.delivery(destination, args);
    if (!anchors.msg_id && !anchors.event_id && args.streamId === undefined) this.sessions.assertProactive(destination);
    let payload: JsonObject;
    let suffix = 'messages';
    let streamData: JsonObject = {};
    let sequence: number | undefined;
    let multipart: { bytes: Uint8Array; name: string } | undefined;
    let prior: StreamState | undefined;
    if (action === 'media') {
      const fileType = this.validateMedia(args);
      if ((destination.kind === 'channel' || destination.kind === 'dms') && fileType !== 1) throw new Error('Channels and DMS accept images only');
      const limit = Math.min(this.cfg.maxMediaBytes, MEDIA_LIMITS[fileType]);
      let bytes: Uint8Array | undefined;
      let url = args.url === undefined ? undefined : remoteUrl(args.url);
      let name = basename(args.fileName !== undefined ? string(args.fileName, 'fileName') : fileType === 1 ? 'image.png' : fileType === 3 ? 'voice.silk' : 'attachment');
      if (args.blob !== undefined) {
        const handle = mediaBlobHandle(args.blob);
        bytes = this.host.blob(handle)?.bytes;
        if (!bytes) throw new Error('Blob not found');
      }
      if (bytes && (!bytes.length || bytes.byteLength > limit)) throw new Error('Media exceeds maxMediaBytes or QQ file type limit');
      if (fileType === 3) {
        if (!bytes) bytes = await publicMedia(url!, limit, this.cfg.timeoutMs, combined);
        bytes = await audioToSilk(bytes, { signal: combined, timeoutMs: this.cfg.timeoutMs, ffmpegPath: this.cfg.ffmpegPath }); url = undefined;
        name = name.replace(/\.[^.]*$/, '') + '.silk';
        if (bytes.byteLength > limit) throw new Error('Converted audio exceeds maxMediaBytes or QQ voice limit');
      }
      if (destination.kind === 'channel' || destination.kind === 'dms') {
        if (fileType !== 1) throw new Error('Channels and DMS accept images only');
        if (bytes) { multipart = { bytes, name }; payload = {}; }
        else payload = { image: url };
      } else {
        const info = await this.uploader!.upload(destination, fileType, { bytes, url, name }, combined);
        payload = { msg_type: 7, media: { file_info: info }, content: ' ' };
      }
      if (args.content !== undefined) payload.content = string(args.content, 'content');
    } else {
      const content = typeof args.content === 'string' ? args.content : string(args.content, 'content');
      const format = args.format ?? 'text';
      if (format !== 'text' && format !== 'markdown') throw new Error('Invalid format');
      if (action === 'stream') {
        if (destination.kind !== 'c2c') throw new Error('Streaming requires a c2c target');
        if (args.finish !== undefined && typeof args.finish !== 'boolean') throw new Error('Invalid finish');
        const finish = args.finish !== false;
        let index = 0;
        if (args.streamId !== undefined) {
          const streamId = string(args.streamId, 'streamId');
          prior = this.streams.get(this.streamKey(destination, streamId));
          if (!prior) throw new Error('Stream not found or already finished');
          if (prior.uncertain) throw new Error('Previous stream delivery is unknown; do not resend its content');
          if ((args.replyTo !== undefined && args.replyTo !== prior.anchors.msg_id) || (args.eventId !== undefined && args.eventId !== prior.anchors.event_id)
            || (args.format !== undefined && format !== prior.format)) throw new Error('Stream target, format and reply anchor must remain unchanged');
          anchors = prior.anchors;
          sequence = prior.sequence; index = prior.index + 1;
          streamData = { streamId, format: prior.format };
        }
        if (!content && !args.streamId) throw new Error('The first stream part needs content');
        streamData = { ...streamData, index, finish, format: streamData.format ?? format };
        // A terminal Markdown part needs a newline; an empty DONE frame must still carry one.
        const terminalNewline = finish && (streamData.format === 'markdown' || !content) && !content.endsWith('\n');
        payload = { input_mode: 'append', input_state: finish ? 10 : 1, index, content_type: streamData.format,
          content_raw: content + (terminalNewline ? '\n' : ''), ...(args.streamId ? { stream_msg_id: args.streamId } : {}) };
        suffix = 'stream_messages';
      } else {
        string(content, 'content');
        payload = format === 'markdown' ? { markdown: { content } } : { content };
        if (destination.kind === 'c2c' || destination.kind === 'group') payload.msg_type = format === 'markdown' ? 2 : 0;
        if (args.referenceId !== undefined) payload.message_reference = { message_id: string(args.referenceId, 'referenceId') };
        if (args.keyboard !== undefined) payload.keyboard = object(args.keyboard);
      }
    }
    sequence ??= await this.prepare(destination, anchors);
    if (prior) {
      await waitUntil(prior.at + this.cfg.streamIntervalMs, combined);
      await this.push('attempt', destination, { ...anchors, msg_seq: sequence, streamId: prior.streamId, index: streamData.index });
      prior.uncertain = true;
    }
    combined.throwIfAborted();
    if (destination.kind === 'c2c' || destination.kind === 'group') payload.msg_seq = sequence;
    Object.assign(payload, anchors);
    let sent: Awaited<ReturnType<typeof sendWithFallback>>;
    try { sent = await sendWithFallback({ payload, signal: combined, fallback: args.fallback === undefined ? this.cfg.autoFallback : args.fallback === true,
      continuation: !!prior,
      proactive: () => this.prepare(destination, {}),
      send: async final => {
        let body: JsonObject | FormData = final;
        if (multipart) {
          const form = new FormData();
          for (const [key, value] of Object.entries(final)) if (value !== undefined) form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
          form.set('file_image', new Blob([new Uint8Array(multipart.bytes)]), multipart.name); body = form;
        }
        const proactive = !final.msg_id && !final.event_id && !prior;
        if (proactive) await this.proactive(destination, combined);
        try {
          const result = await this.client!.request('POST', `${route(destination)}/${suffix}`, body, combined);
          if (typeof result.id !== 'string' || !result.id) throw new Error('QQ accepted the request without a message id; delivery is unknown, do not resend');
          return result;
        } finally {
          // Token refresh and network latency must not consume the next send's cooldown.
          // Include rejected attempts so fallback retries obey the same interval.
          if (proactive) this.lastProactiveAt = Date.now();
        }
      },
    }); } catch (error) {
      if (prior && error instanceof QQOfficialApiError && error.rejected) {
        // An explicit rejection leaves the previous confirmed part intact; DONE can still close it.
        await this.push('notice', destination, { eventType: 'STREAM_PART_REJECTED', streamId: prior.streamId, index: streamData.index });
        prior.uncertain = false;
        if (!streamData.finish) this.watchStream(prior);
      }
      throw error;
    }
    const { result } = sent; payload = sent.payload;
    anchors = { ...(payload.msg_id ? { msg_id: payload.msg_id } : {}), ...(payload.event_id ? { event_id: payload.event_id } : {}), ...(payload.is_wakeup ? { is_wakeup: true } : {}) };
    sequence = typeof payload.msg_seq === 'number' ? payload.msg_seq : sequence;
    const messageId = typeof result.id === 'string' ? result.id : undefined;
    if (action === 'stream') { streamData.streamId = string(result.id, 'stream response id'); streamData.format = payload.content_type; }
    const receipt: JsonObject = { target: destination, ...anchors, msg_seq: sequence, ...streamData,
      ...(prior ? { previousStreamId: prior.streamId } : {}), messageId, request: payload, result, fallbacks: sent.fallbacks,
      ...(action === 'media' ? { fileType: args.fileType, ...(args.fileName !== undefined ? { fileName: basename(String(args.fileName)) } : {}) } : {}) };
    // Stream parts share one message id, so only the first part takes a new reference.
    const known = messageId ? this.refByMessage.get(messageId) : undefined;
    const ref = messageId ? known ?? String(this.nextRef) : '';
    const saved = await this.push('sent', destination, receipt, false, ref ? { ref } : {}, this.sentLine(receipt, ref));
    if (messageId && !known) this.remember(ref, destination, messageId, saved.cursor);
    this.rememberStream(receipt, Date.now());
    return { receipt };
  }

  private validateMedia(args: JsonObject): number {
    if ('path' in args) throw new Error('Direct local paths are no longer supported; attach the file through the host and use its log:/mem: blob handle');
    const type = integer(args.fileType, 'fileType', 1, 4);
    if (['url', 'blob'].filter(k => args[k] !== undefined).length !== 1) throw new Error('Supply exactly one of url or blob');
    if (args.blob !== undefined) mediaBlobHandle(args.blob);
    if (args.url !== undefined) remoteUrl(args.url);
    return type;
  }

  private delivery(destination: QQOfficialTarget, args: JsonObject): JsonObject {
    if (args.fallback !== undefined && typeof args.fallback !== 'boolean') throw new Error('Invalid fallback');
    const anchors = this.anchors(args);
    const mode = args.delivery ?? (Object.keys(anchors).length ? 'reply' : 'proactive');
    if (!['auto', 'reply', 'proactive', 'wakeup'].includes(String(mode))) throw new Error('Invalid delivery');
    if (mode === 'proactive' || mode === 'wakeup') {
      if (Object.keys(anchors).length) throw new Error('Proactive/wakeup delivery cannot include replyTo or eventId');
      if (mode === 'wakeup') {
        if (destination.kind !== 'c2c') throw new Error('Wakeup messages require a c2c target');
        return { is_wakeup: true };
      }
      return {};
    }
    if (!Object.keys(anchors).length) {
      const recent = this.sessions.recentReply(destination);
      if (recent) return { msg_id: recent };
      if (mode === 'reply') throw new Error('No recent reply anchor; choose proactive delivery or wait for a user message');
    }
    return anchors;
  }

  private async proactive(destination: QQOfficialTarget, signal: AbortSignal): Promise<void> {
    this.sessions.assertProactive(destination);
    await waitUntil(this.lastProactiveAt + this.cfg.proactiveIntervalMs, signal);
  }

  private streamKey(destination: QQOfficialTarget, id: string): string { return JSON.stringify([targetKey(destination), id]); }
  private rememberStream(receipt: JsonObject, at: number): void {
    if (!receipt.streamId || !receipt.target) return;
    const destination = receipt.target as QQOfficialTarget;
    const id = String(receipt.streamId);
    if (typeof receipt.previousStreamId === 'string') {
      const previous = this.streamKey(destination, receipt.previousStreamId);
      this.streams.delete(previous); clearTimeout(this.streamTimers.get(previous)); this.streamTimers.delete(previous);
    }
    const key = this.streamKey(destination, id);
    clearTimeout(this.streamTimers.get(key)); this.streamTimers.delete(key);
    if (receipt.finish) { this.streams.delete(key); return; }
    const state: StreamState = { target: destination, streamId: id, format: String(receipt.format),
      anchors: { ...(receipt.msg_id ? { msg_id: receipt.msg_id } : {}), ...(receipt.event_id ? { event_id: receipt.event_id } : {}), ...(receipt.is_wakeup ? { is_wakeup: true } : {}) },
      sequence: Number(receipt.msg_seq), index: Number(receipt.index), at };
    this.streams.set(key, state);
    this.watchStream(state);
  }
  private watchStream(state: StreamState): void {
    if (state.uncertain) return;
    const key = this.streamKey(state.target, state.streamId);
    clearTimeout(this.streamTimers.get(key));
    const timer = setTimeout(() => {
      this.streamTimers.delete(key);
      void this.enqueue(async () => {
        if (this.streams.get(key) !== state || state.uncertain) return;
        await this.execute('stream', { target: state.target, streamId: state.streamId, content: '', finish: true });
      }).catch(error => this.host?.log.warn('qqofficial.stream.close_failed', { error: String(error) }));
    }, Math.max(0, state.at + this.cfg.streamIdleMs - Date.now()));
    timer.unref?.(); this.streamTimers.set(key, timer);
  }

  private followModel(destination: QQOfficialTarget, args: JsonObject, anchors: JsonObject): string {
    if (args.streamId !== undefined || args.finish !== undefined || args.content) throw new Error('followModel starts a new reply without content, finish or streamId');
    if (args.format !== undefined && !['text', 'markdown'].includes(String(args.format))) throw new Error('Invalid format');
    if (this.replyStream && !this.replyStream.closed) throw new Error('A streamed reply is already active');
    let streamId: string | undefined;
    let content = '';
    // Proactive notifications use the regular endpoint; native streams are reserved for anchored C2C replies.
    let buffered = destination.kind !== 'c2c' || (!anchors.msg_id && !anchors.event_id);
    const options = { target: destination, format: args.format ?? 'markdown', fallback: args.fallback,
      ...(anchors.msg_id ? { replyTo: anchors.msg_id } : {}), ...(anchors.event_id ? { eventId: anchors.event_id } : {}),
      delivery: anchors.is_wakeup ? 'wakeup' : anchors.msg_id || anchors.event_id ? 'reply' : 'proactive' };
    this.replyTarget = destination; this.replyCursor = this.host!.store.latestCursor();
    // Core may execute this tool eagerly before its calling model round has ended.
    this.replyWaitForRound = this.modelRoundOpen;
    this.replyStream = new QQReplyStream({ intervalMs: this.cfg.streamIntervalMs, idleMs: this.cfg.streamIdleMs,
      send: async (delta, finish) => {
        if (buffered) {
          content += delta;
          if (content.length > 64000) throw new Error('QQ reply exceeds 64000 characters');
          if (finish && content) await this.enqueue(() => this.execute('send', { ...options, content }));
          return;
        }
        let result: string | ToolOutcome | SentResult | SentResult[];
        try { result = await this.enqueue(() => this.execute('stream', streamId
          ? { target: destination, streamId, content: delta, finish }
          : { ...options, content: delta, finish })); }
        catch (error) {
          if (!streamId && (args.fallback ?? this.cfg.autoFallback) && error instanceof QQOfficialApiError
            && error.rejected && [404, 405].includes(error.status)) {
            buffered = true; content = delta;
            await this.push('notice', destination, { eventType: 'REPLY_STREAM_BUFFERED', reason: `HTTP ${error.status}` });
            if (finish && content) await this.enqueue(() => this.execute('send', { ...options, content }));
            return;
          }
          throw error;
        }
        streamId = String((result as SentResult).receipt.streamId);
      },
      error: error => {
        this.host?.log.warn('qqofficial.stream.failed', { error: String(error) });
        if (this.host) void this.push('notice', destination, { eventType: 'REPLY_STREAM_FAILED', error: String(error), streamId,
          instruction: 'Some content may already be visible. Do not resend the complete reply.' }, true).catch(() => {});
      },
    });
    return JSON.stringify({ target: destination, streaming: !buffered,
      instruction: 'Your next model round public response text will be sent to this QQ target automatically. Do not call another send tool for the same text. Reasoning and tool arguments are excluded. The reply closes at round end, abort or idle timeout.' });
  }

  webUi(language?: Language): WorldWebUiDecl {
    const t = qqOfficialText(language);
    return {
      label: 'QQ Official',
      lamps: [{ label: t.connection, state: this.state === 'connecting' ? 'loading' : this.state, hint: this.detail || t[this.state] }],
      // A dedicated configuration panel keeps secret writes out of the generic config JSON.
      panels: [{ id: 'connection', title: t.connectionTab }, { id: 'configuration', title: t.configTab }],
      invoke: (panel, method, args) => {
        if (panel !== 'connection' && panel !== 'configuration') return Promise.reject(new Error('Unknown panel'));
        const task = this.control.then(async () => {
          if (method === 'state') {
            const state = { appId: this.cfg.appId, secretSet: !!this.options.context.secret(QQOFFICIAL_SECRET),
              enabled: this.cfg.enabled, status: this.state, detail: this.detail, binding: this.binding.current(), text: t };
            if (panel === 'connection') return state;
            const group = qqOfficialConfigGroup(language);
            const root = { worlds: { qqofficial: this.cfg } };
            return { ...state, group, values: Object.fromEntries(Object.keys(group.schema.properties).map((key) => [key, getByPath(root, key)])) };
          }
          if (panel === 'configuration') {
            if (method !== 'save') throw new Error('Unknown method');
            const data = object(args[0]);
            const result = coerceGroupValues(qqOfficialConfigGroup(language), object(data.values), language);
            if ('error' in result) throw new Error(result.error);
            const next = structuredClone(this.cfg);
            const root = { worlds: { qqofficial: next } };
            for (const [key, value] of Object.entries(result.values)) setByPath(root, key, value);
            validateConfig(next);
            const secret = typeof data.secret === 'string' ? data.secret : '';
            if (next.appId !== this.cfg.appId || secret) this.saveCredentials(string(next.appId, 'AppID'), secret);
            this.options.context.persist(next);
            this.binding.clear();
            const connectionError = next.enabled ? await this.connect() : undefined;
            return { message: t.configSaved, connectionError };
          }
          if (method === 'bind') return this.binding.start();
          if (method === 'poll') {
            const result = await this.binding.poll();
            if (result.kind !== 'bound') return { kind: result.kind, message: t[result.kind] };
            this.saveCredentials(result.appId, result.secret);
            this.binding.clear();
            return { kind: 'bound', appId: result.appId, connectionError: await this.connect() };
          }
          if (method === 'cancel') {
            this.binding.clear();
            return {};
          }
          if (method === 'connect') return { connectionError: await this.connect() };
          throw new Error('Unknown method');
        });
        this.control = task.catch(() => undefined);
        return task;
      },
      promptDocs: [{ key: 'worlds.qqofficial.envPrompt', title: t.promptTitle, description: t.promptDescription,
        role: 'envPrompt', path: fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)),
        vars: [{ name: 'qqofficial.environment', description: t.promptDescription, multiline: true },
          { name: 'qqofficial.conversations', description: t.promptConversations, multiline: true },
          { name: 'qqofficial.identity', description: t.promptIdentity }] }],
    };
  }

  private async connect(): Promise<string | undefined> {
    try {
      string(this.cfg.appId, 'AppID');
      string(this.options.context.secret(QQOFFICIAL_SECRET), 'AppSecret');
      this.options.context.persist({ enabled: true });
      await this.options.context.restart();
    }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }

  private saveCredentials(appId: string, secret: string): void {
    if (/[\r\n]/.test(appId + secret)) throw new Error('Credentials must occupy one line');
    if (!secret && (appId !== this.cfg.appId || !this.options.context.secret(QQOFFICIAL_SECRET))) throw new Error('AppSecret required');
    if (secret) this.options.context.storeSecret(QQOFFICIAL_SECRET, secret);
    this.options.context.persist({ appId });
  }
}
